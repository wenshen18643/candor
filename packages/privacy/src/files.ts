import type { JSZipObject } from "jszip";

import type { FileKind, MetadataField, StrippedFile } from "./types.js";

type InputFile = { name: string; type: string; bytes: Uint8Array };
type Content = {
  bytes: Uint8Array;
  text: string | null;
  removed: MetadataField[];
  remaining?: MetadataField[];
  anchorDate?: string | null;
  mime?: string;
};
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const field = (name: string, value: string): MetadataField => ({
  field: name,
  value,
  risk: /author|creator|lastmodifiedby|initials|name|email|gps|latitude|longitude|serial|company|manager|from|ip|received|path|xmp/i.test(
    name,
  )
    ? "high"
    : "medium",
});

function classify(file: InputFile): FileKind {
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "pdf" || file.type === "application/pdf") return "pdf";
  if (extension === "docx" || file.type.includes("wordprocessingml")) return "docx";
  if (extension === "eml" || file.type === "message/rfc822") return "email";
  if (file.type.startsWith("image/") || /^(png|jpe?g|webp|gif|tiff?|heic)$/.test(extension ?? ""))
    return "image";
  if (extension === "csv" || file.type === "text/csv") return "csv";
  if (extension === "chat" || /^chat[-_.]/i.test(file.name)) return "chat";
  if (extension === "md" || extension === "markdown") return "memo";
  if (/^(txt|md|markdown|log|json|tsv)$/.test(extension ?? "") || file.type.startsWith("text/"))
    return "text";
  return "unsupported";
}

async function stripPdf(bytes: Uint8Array): Promise<Content> {
  const { PDFDocument, PDFDict, PDFName, PDFRef, PDFStream } = await import("pdf-lib");
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const removed: MetadataField[] = [];
  const infoRef = pdf.context.trailerInfo.Info;
  const info = infoRef ? pdf.context.lookup(infoRef) : undefined;
  if (info instanceof PDFDict)
    for (const [key, value] of info.entries())
      removed.push(field(key.decodeText(), value.toString()));
  if (infoRef instanceof PDFRef) pdf.context.delete(infoRef);
  delete pdf.context.trailerInfo.Info;
  if (pdf.context.trailerInfo.ID) {
    removed.push(field("ID", "Document identifier"));
    delete pdf.context.trailerInfo.ID;
  }
  for (const [reference, object] of pdf.context.enumerateIndirectObjects()) {
    const dict =
      object instanceof PDFDict ? object : object instanceof PDFStream ? object.dict : undefined;
    if (!dict) continue;
    const metadata = dict.get(PDFName.of("Metadata"));
    if (metadata) {
      removed.push(field("XMP", "Embedded metadata"));
      dict.delete(PDFName.of("Metadata"));
      if (metadata instanceof PDFRef) pdf.context.delete(metadata);
    }
    if (dict.get(PDFName.of("Type")) === PDFName.of("Metadata")) {
      pdf.context.delete(reference);
    }
  }
  const output = await pdf.save({ useObjectStreams: false });
  const { getDocumentProxy, extractText } = await import("unpdf");
  const proxy = await getDocumentProxy(output.slice(), { verbosity: 0 });
  try {
    return { bytes: output, text: (await extractText(proxy, { mergePages: true })).text, removed };
  } finally {
    await proxy.loadingTask.destroy();
  }
}

function xmlMetadata(xml: string, prefix: string): MetadataField[] {
  return Array.from(xml.matchAll(/<([\w:.-]+)(?:\s[^>]*)?>([^<]+)<\/\1>/g), (match) =>
    field(`${prefix}/${match[1]!}`, match[2]!),
  );
}

type ZipStream = {
  on(event: "data", callback: (chunk: Uint8Array) => void): ZipStream;
  on(event: "error" | "end", callback: () => void): ZipStream;
  pause(): ZipStream;
  resume(): ZipStream;
};

function readZipEntry(entry: JSZipObject, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let failed = false;
    const stream = (
      entry as JSZipObject & { internalStream(type: "uint8array"): ZipStream }
    ).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        stream.pause();
        reject(new Error("Document expands beyond limit"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", () => reject(new Error("Invalid document archive")));
    stream.on("end", () => {
      if (failed) return;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(bytes);
    });
    stream.resume();
  });
}

async function stripDocx(bytes: Uint8Array): Promise<Content> {
  const { default: JSZip } = await import("jszip");
  const { default: mammoth } = await import("mammoth/mammoth.browser.js");
  const zip = (await JSZip.loadAsync(bytes)) as InstanceType<typeof JSZip> & { comment: string };
  const removed: MetadataField[] = [];
  let expanded = 0;
  if (Object.keys(zip.files).length > 10000) throw new Error("Too many archive entries");
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const raw = await readZipEntry(entry, 100 * 1024 * 1024 - expanded);
    expanded += raw.length;
    if (expanded > 100 * 1024 * 1024) throw new Error("Document expands beyond limit");
    if (entry.name === "docProps/core.xml" || entry.name === "docProps/app.xml") {
      removed.push(...xmlMetadata(decoder.decode(raw), entry.name));
      const xml = entry.name.endsWith("core.xml")
        ? '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>'
        : '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>';
      zip.file(entry.name, xml);
    } else if (
      entry.name === "docProps/custom.xml" ||
      entry.name.startsWith("docProps/thumbnail")
    ) {
      removed.push(field(entry.name, "Custom metadata"));
      zip.remove(entry.name);
    } else if (entry.name.endsWith(".xml") && entry.name.startsWith("word/")) {
      const xml = decoder
        .decode(raw)
        .replace(
          /\bw:(author|initials|date)\s*=\s*(["'])(.*?)\2/g,
          (_match, attribute: string, quote: string, value: string) => {
            removed.push(field(`w:${attribute}`, value));
            return attribute === "date" ? "" : `w:${attribute}=${quote}Redacted${quote}`;
          },
        );
      zip.file(entry.name, xml);
    } else if (entry.name.endsWith(".rels") || entry.name === "[Content_Types].xml") {
      const xml = decoder
        .decode(raw)
        .replace(
          /<(?:\w+:)?(?:Relationship|Override)\b[^>]*(?:custom\.xml|thumbnail)[^>]*\/?\s*>/g,
          "",
        );
      zip.file(entry.name, xml);
    }
  }
  if (zip.comment) removed.push(field("ZIP comment", zip.comment));
  zip.comment = "";
  zip.forEach((_path, entry) => {
    entry.date = new Date("1980-01-01T00:00:00Z");
    entry.comment = "";
  });
  const output = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const extracted = await mammoth.extractRawText({ arrayBuffer: new Uint8Array(output).buffer });
  return { bytes: output, text: extracted.value, removed };
}

function htmlText(html: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    commat: "@",
    period: ".",
    colon: ":",
    sol: "/",
  };
  return html
    .replace(
      /<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi,
      "",
    )
    .replace(/<br\b[^>]*>|<\/(?:p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|commat|period|colon|sol);/gi,
      (entity, name: string) => {
        if (!name.startsWith("#")) return entities[name.toLowerCase()] ?? entity;
        const code =
          name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code)
          : "�";
      },
    );
}

async function stripEmail(bytes: Uint8Array): Promise<Content> {
  const { default: PostalMime, decodeWords } = await import("postal-mime");
  const email = await PostalMime.parse(new Uint8Array(bytes).buffer);
  const kept = new Set(["date", "from", "to", "cc", "subject"]);
  const removed = email.headers
    .filter((header) => !kept.has(header.key))
    .map((header) => field(header.key, header.value));
  const headers = email.headers
    .filter((header) => kept.has(header.key))
    .map((header) => `${header.key}: ${header.value.replace(/[\r\n]+/g, " ")}`);
  const body = email.text ?? htmlText(email.html ?? "");
  if (email.attachments.length)
    removed.push(field("Attachments", `${email.attachments.length} attachments omitted`));
  const text = `${headers.map((header) => decodeWords(header)).join("\n")}\n\n${body}`;
  const output = `${headers.join("\r\n")}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body.replace(/\r?\n/g, "\r\n")}`;
  const date = email.date ? new Date(email.date) : null;
  return {
    bytes: encoder.encode(output),
    text,
    removed,
    anchorDate: date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null,
  };
}

async function stripImage(bytes: Uint8Array): Promise<Content> {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined")
    return {
      bytes: bytes.slice(),
      text: null,
      removed: [],
      remaining: [field("Image metadata", "Image sanitization requires a browser canvas")],
    };
  const { default: exifr } = await import("exifr");
  const metadata = (await exifr.parse(bytes, {
    tiff: true,
    exif: true,
    gps: true,
    xmp: true,
    iptc: true,
    icc: true,
  })) as Record<string, unknown> | undefined;
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("Image exceeds pixel limit");
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image canvas unavailable");
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      text: null,
      removed: Object.entries(metadata ?? {}).map(([key, value]) => field(key, String(value))),
      mime: "image/png",
    };
  } finally {
    bitmap.close();
  }
}

function stripText(bytes: Uint8Array): Content {
  const input = decoder.decode(bytes);
  const text = input.replace(/[\uFEFF\u200B-\u200D\u2060]/g, "");
  return {
    bytes: encoder.encode(text),
    text,
    removed:
      input === text ? [] : [field("Invisible characters", String(input.length - text.length))],
  };
}

export async function stripAndExtract(file: InputFile): Promise<StrippedFile> {
  if (file.bytes.length > 25 * 1024 * 1024) throw new Error("File exceeds size limit");
  const kind = classify(file);
  let content: Content;
  try {
    if (kind === "pdf") content = await stripPdf(file.bytes);
    else if (kind === "docx") content = await stripDocx(file.bytes);
    else if (kind === "email") content = await stripEmail(file.bytes);
    else if (kind === "image") content = await stripImage(file.bytes);
    else if (kind === "unsupported")
      content = {
        bytes: file.bytes.slice(),
        text: null,
        removed: [],
        remaining: [field("Unsupported format", "Metadata could not be inspected")],
      };
    else content = stripText(file.bytes);
  } catch {
    throw new Error("File sanitization failed");
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(content.bytes)),
  );
  return {
    name: file.name,
    mime:
      content.mime ??
      (file.type ||
        {
          pdf: "application/pdf",
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          email: "message/rfc822",
          csv: "text/csv",
          text: "text/plain",
          chat: "text/plain",
          memo: "text/markdown",
          image: "application/octet-stream",
          unsupported: "application/octet-stream",
        }[kind]),
    kind,
    originalSize: file.bytes.length,
    bytes: content.bytes,
    sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    metadataRemoved: content.removed,
    metadataRemaining: content.remaining ?? [],
    text: content.text,
    anchorDate: content.anchorDate ?? null,
    title: file.name,
  };
}
