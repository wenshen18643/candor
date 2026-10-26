import JSZip from "jszip";
import { PDFDocument, PDFName } from "pdf-lib";
import PostalMime from "postal-mime";
import { describe, expect, it } from "vitest";

import type { Detection, ScrubResult, TextDocument } from "../src/index.js";
import {
  assessLeakage,
  buildAnalysisPayload,
  detectPii,
  scrub,
  stripAndExtract,
} from "../src/index.js";
import { docxFixture, emailFixture, pdfFixture } from "./fixtures.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("metadata removal reparsed from output bytes", () => {
  it("extracts HTML-only email text and decodes numeric identity escapes", async () => {
    const bytes = encode(
      "Content-Type: text/html; charset=utf-8\r\n\r\n<p>&#65;lice&#32;Smith sent alice&commat;example&period;com.</p><script>tracking()</script>",
    );
    const output = await stripAndExtract({ name: "html.eml", type: "message/rfc822", bytes });
    expect(output.text).toContain("Alice Smith sent alice@example.com.");
    expect(output.text).not.toContain("tracking()");
    const mail = await PostalMime.parse(new Uint8Array(output.bytes).buffer);
    expect(mail.html).toBeUndefined();
    expect(mail.text).toContain("Alice Smith");
  });
  it("decodes MIME encoded header names before PII detection", async () => {
    const bytes = encode(
      "From: =?UTF-8?B?QWxpY2UgU21pdGg=?= <sender@example.com>\r\nSubject: =?UTF-8?B?QWxpY2UgU21pdGg=?=\r\n\r\nInvoice review.",
    );
    const output = await stripAndExtract({ name: "encoded.eml", type: "message/rfc822", bytes });
    expect(output.text).toContain("Alice Smith");
    const docs = [{ docKey: "mail", text: output.text! }];
    const cleaned = scrub(docs, detectPii(docs, { selfTerms: ["Alice Smith"] }));
    expect(cleaned.documents[0]!.text).not.toMatch(/Alice|Smith|QWxpY2U/);
    expect(cleaned.selfRedactionCount).toBe(2);
  });
  it("removes PDF Info, XMP objects and identifiers while preserving text", async () => {
    const bytes = await pdfFixture();
    const output = await stripAndExtract({ name: "memo.pdf", type: "application/pdf", bytes });
    const pdf = await PDFDocument.load(output.bytes, { updateMetadata: false });
    expect(pdf.context.trailerInfo.Info).toBeUndefined();
    expect(pdf.context.trailerInfo.ID).toBeUndefined();
    expect(pdf.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
    expect(decode(output.bytes)).not.toContain("Fixture Private");
    expect(output.text).toContain("Barack Obama reviewed the invoice.");
    expect(output.metadataRemaining).toEqual([]);
    expect(output.metadataRemoved.map((entry) => entry.field)).toEqual(
      expect.arrayContaining([
        "Author",
        "Creator",
        "Title",
        "Subject",
        "Keywords",
        "Producer",
        "CreationDate",
        "ModDate",
        "XMP",
        "ID",
      ]),
    );
    expect(output.metadataRemoved.find((entry) => entry.field === "Author")?.risk).toBe("high");
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(output.bytes)),
    );
    expect(output.sha256).toBe(
      Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
  });
  it("removes DOCX properties and tracked authors, repairs relationships", async () => {
    const output = await stripAndExtract({
      name: "memo.docx",
      type: "",
      bytes: await docxFixture(),
    });
    const zip = await JSZip.loadAsync(output.bytes);
    expect(zip.file("docProps/custom.xml")).toBeNull();
    expect(zip.file("docProps/thumbnail.jpeg")).toBeNull();
    for (const name of [
      "docProps/core.xml",
      "docProps/app.xml",
      "word/document.xml",
      "word/comments.xml",
    ]) {
      const xml = await zip.file(name)!.async("string");
      expect(xml).not.toContain("Private");
      expect(xml).not.toContain("2026-01-01");
    }
    expect(await zip.file("word/document.xml")!.async("string")).toContain('w:author="Redacted"');
    expect(await zip.file("word/comments.xml")!.async("string")).toContain('w:initials="Redacted"');
    expect(await zip.file("_rels/.rels")!.async("string")).not.toContain("custom.xml");
    expect(await zip.file("[Content_Types].xml")!.async("string")).not.toContain("custom.xml");
    expect(output.text).toContain("Barack Obama approved the invoice.");
    expect(output.metadataRemaining).toEqual([]);
    expect(output.metadataRemoved.some((entry) => entry.field.includes("creator"))).toBe(true);
    expect(output.metadataRemoved.find((entry) => entry.field.includes("Company"))?.risk).toBe(
      "high",
    );
    expect(Object.values(zip.files).every((entry) => entry.date.getUTCFullYear() === 1980)).toBe(
      true,
    );
  });
  it("removes tracing headers from EML and preserves content and date", async () => {
    const output = await stripAndExtract({
      name: "mail.eml",
      type: "message/rfc822",
      bytes: emailFixture(),
    });
    const mail = await PostalMime.parse(new Uint8Array(output.bytes).buffer);
    const headerKeys = mail.headers.map((header) => header.key);
    for (const removed of [
      "received",
      "x-originating-ip",
      "message-id",
      "x-mailer",
      "user-agent",
      "return-path",
      "dkim-signature",
      "authentication-results",
    ])
      expect(headerKeys).not.toContain(removed);
    expect(mail.from?.address).toBe("barack.obama@example.com");
    expect(mail.subject).toBe("Invoice review");
    expect(mail.text).toContain("Barack approved the invoice.");
    expect(output.anchorDate).toBe("2026-10-26");
    expect(decode(output.bytes)).not.toContain("private-");
    expect(output.text).toContain("barack.obama@example.com");
    expect(output.metadataRemaining).toEqual([]);
  });
  it("strips invisible fingerprints from UTF-8 and reports unsupported images in Node", async () => {
    for (const name of ["memo.md", "text.txt", "table.csv"]) {
      const output = await stripAndExtract({
        name,
        type: "",
        bytes: encode("\uFEFFHello\u200B there\u200D\u2060."),
      });
      expect(decode(output.bytes)).toBe("Hello there.");
      expect(output.text).toBe("Hello there.");
      expect(output.metadataRemoved).toHaveLength(1);
      expect(output.metadataRemaining).toEqual([]);
    }
    const image = await stripAndExtract({
      name: "photo.jpg",
      type: "image/jpeg",
      bytes: new Uint8Array([1]),
    });
    expect(image.kind).toBe("image");
    expect(image.text).toBeNull();
    expect(image.metadataRemaining).toHaveLength(1);
    const unknown = await stripAndExtract({
      name: "archive.bin",
      type: "",
      bytes: new Uint8Array([1]),
    });
    expect(unknown.kind).toBe("unsupported");
    expect(unknown.metadataRemaining).toHaveLength(1);
    await expect(
      stripAndExtract({ name: "bad.pdf", type: "", bytes: encode("private invalid PDF") }),
    ).rejects.toThrow("File sanitization failed");
    await expect(
      stripAndExtract({ name: "bad.txt", type: "", bytes: new Uint8Array([255]) }),
    ).rejects.toThrow("File sanitization failed");
  });
});

describe("PII precision and self precedence", () => {
  it("detects varied direct identifiers and rejects invalid checksum lookalikes", () => {
    const text =
      "Barack Obama visited Paris and Microsoft. Email barack.obama@example.com; phone +1 415 555 2671. IBAN GB82 WEST 1234 5698 7654 32; card 4111 1111 1111 1111. SSN 123-45-6789, badge EMP-12345. Server 192.168.1.10 or 2001:db8::1. URL https://example.com/private. DOB: 1985-06-02. Invalid 999.999.999.999 and card 4111 1111 1111 1112. Monday began quietly. The invoice total was 1234.56.";
    const hits = detectPii([{ docKey: "D1", text }], { selfTerms: [] });
    const expected: [string, string][] = [
      ["person", "Barack Obama"],
      ["place", "Paris"],
      ["org", "Microsoft"],
      ["email", "barack.obama@example.com"],
      ["phone", "+1 415 555 2671"],
      ["account", "GB82 WEST 1234 5698 7654 32"],
      ["account", "4111 1111 1111 1111"],
      ["id", "123-45-6789"],
      ["id", "EMP-12345"],
      ["ip", "192.168.1.10"],
      ["ip", "2001:db8::1"],
      ["url", "https://example.com/private"],
      ["date_of_birth", "1985-06-02"],
    ];
    for (const [type, value] of expected)
      expect(
        hits.some((hit) => hit.type === type && hit.text === value),
        type,
      ).toBe(true);
    expect(hits.some((hit) => /999\.999|1112|Monday|1234\.56/.test(hit.text))).toBe(false);
    expect(hits.length).toBeLessThanOrEqual(expected.length + 2);
    expect(hits.every((hit) => text.slice(hit.start, hit.end) === hit.text)).toBe(true);
    expect(new Set(hits.map((hit) => hit.id)).size).toBe(hits.length);
  });
  it("self variants override keep decisions and use boundaries", () => {
    const docs = [
      {
        docKey: "S",
        text: "Alice Smith wrote this. ALICE and Smith called +1 (415) 555-2671. alice.smith@example.com replied. Malice is unrelated.",
      },
    ];
    const hits = detectPii(docs, {
      selfTerms: ["Alice Smith", "alice.smith@example.com", "+1 415 555 2671"],
    });
    const result = scrub(
      docs,
      hits,
      hits.map((hit) => ({ detectionId: hit.id, action: "keep" })),
    );
    expect(result.documents[0]!.text).not.toMatch(/\bAlice\b|\bSmith\b|415|example\.com/i);
    expect(result.documents[0]!.text).toContain("Malice");
    expect(result.selfRedactionCount).toBeGreaterThanOrEqual(5);
    expect(result.pseudonymMap).toEqual([]);
    expect(result.documents[0]!.text).toContain("[REDACTED]");
  });
  it("custom terms are literal, Unicode-safe, and deterministic", () => {
    const docs = [
      { docKey: "S", text: "Project (Orchid) and René Martin. Project (Orchid) again." },
    ];
    const options = { selfTerms: ["René Martin"], customTerms: ["Project (Orchid)"] };
    const hits = detectPii(docs, options);
    expect(hits.filter((hit) => hit.source === "custom")).toHaveLength(2);
    expect(hits).toEqual(detectPii(docs, options));
    expect(scrub(docs, hits).documents[0]!.text).not.toContain("René");
  });
});

describe("consistent scrubbing", () => {
  it("reserves person email families and preserves distinct email identities", () => {
    const docs = [
      {
        docKey: "a",
        text: "Barack Obama. contact@example.com barack.obama@example.com barack.obama@other.example jane.doe@example.com janedoe@example.com",
      },
    ];
    const result = scrub(docs, detectPii(docs, { selfTerms: [] }));
    const person = result.pseudonymMap.find((entry) => entry.type === "person")!;
    const linked = result.pseudonymMap.find((entry) => entry.value === "barack.obama@example.com")!;
    expect(linked.placeholder).toBe(`EMAIL_${person.placeholder.split("_")[1]}`);
    expect(linked.variants).toContain("barack.obama@other.example");
    const separated = result.pseudonymMap.filter(
      (entry) => entry.value === "jane.doe@example.com" || entry.value === "janedoe@example.com",
    );
    expect(new Set(separated.map((entry) => entry.placeholder)).size).toBe(2);
  });
  it("redacts whole identifiers containing self variants without redacting unrelated badge IDs", () => {
    const docs = [
      { docKey: "a", text: "alice.smith@work.example +1 (415) 555-2671 EMP-12345 EMP-88888" },
    ];
    const result = scrub(
      docs,
      detectPii(docs, { selfTerms: ["alice.smith@home.example", "+1 415 555 2671", "EMP-12345"] }),
    );
    expect(result.documents[0]!.text).toBe("[REDACTED] [REDACTED] [REDACTED] ID_1");
    expect(result.selfRedactionCount).toBe(3);
  });
  it("links first names, surnames and email families across documents", () => {
    const docs = [
      { docKey: "a", text: "Barack Obama reviewed this. Barack asked Jane Doe." },
      {
        docKey: "b",
        text: "Obama replied to barack.obama@example.com. Jane agreed. Barack Obama signed.",
      },
    ];
    const result = scrub(docs, detectPii(docs, { selfTerms: [] }));
    const person = result.pseudonymMap.find((entry) => entry.value === "Barack Obama")!;
    expect(person).toBeDefined();
    expect(person.variants).toEqual(expect.arrayContaining(["Barack", "Obama"]));
    expect(result.documents.every((doc) => !/Barack|Obama|Jane/.test(doc.text))).toBe(true);
    expect(result.documents[1]!.text).toContain(person.placeholder);
    const email = result.pseudonymMap.find((entry) => entry.type === "email")!;
    expect(email.placeholder.split("_")[1]).toBe(person.placeholder.split("_")[1]);
    expect(result.appliedDetections).toBe(7);
  });
  it("does not merge ambiguous first names", () => {
    const docs = [{ docKey: "a", text: "John Smith met John Brown. John left." }];
    const hits: Detection[] = [
      ["John Smith", 0],
      ["John Brown", 15],
      ["John", 27],
    ].map(([text, start], index) => ({
      id: String(index),
      docKey: "a",
      type: "person",
      text: String(text),
      start: Number(start),
      end: Number(start) + String(text).length,
      source: "ner",
      confidence: 1,
    }));
    const result = scrub(docs, hits);
    expect(result.pseudonymMap).toHaveLength(3);
    expect(new Set(result.pseudonymMap.map((entry) => entry.placeholder)).size).toBe(3);
  });
  it("honors keep/redact, rejects stale offsets and unknown decisions", () => {
    const docs = [{ docKey: "a", text: "Email test@example.com or EMP-12345." }];
    const hits = detectPii(docs, { selfTerms: [] });
    const result = scrub(
      docs,
      hits,
      hits.map((hit) => ({
        detectionId: hit.id,
        action: hit.type === "email" ? "keep" : "redact",
      })),
    );
    expect(result.documents[0]!.text).toBe("Email test@example.com or [REDACTED].");
    expect(() => scrub(docs, [{ ...hits[0]!, start: 999 }])).toThrow();
    expect(() => scrub(docs, hits, [{ detectionId: "unknown", action: "keep" }])).toThrow();
    expect(() => detectPii([...docs, ...docs], { selfTerms: [] })).toThrow();
  });
});

function unchanged(text: string): ScrubResult {
  return {
    documents: [{ docKey: "S", text }],
    pseudonymMap: [],
    selfRedactionCount: 0,
    counts: {},
    appliedDetections: 0,
  };
}

describe("leakage and payload boundaries", () => {
  it("scores residual direct identifiers, quasi identifiers, levels and cap", () => {
    expect(assessLeakage(unchanged("The invoice was altered."), []).score).toBe(0);
    expect(assessLeakage(unchanged("Contact test@example.com."), []).score).toBe(25);
    expect(assessLeakage(unchanged("Contact test@example.com."), []).level).toBe("elevated");
    const self = assessLeakage(unchanged("Orchid reported this."), ["Orchid"]);
    expect(self.score).toBe(40);
    expect(self.level).toBe("high");
    const quasi = assessLeakage(
      unchanged(
        "As the only nurse on night shift, I saw 3 employees at 09:42 in a remote rural clinic.",
      ),
      [],
    );
    expect(quasi.quasiIdentifiers.length).toBeGreaterThanOrEqual(3);
    expect(quasi.score).toBeGreaterThanOrEqual(15);
    expect(assessLeakage(unchanged("Orchid Orchid Orchid"), ["Orchid"]).score).toBe(100);
    const docs: TextDocument[] = [
      { docKey: "S", text: "Barack Obama sent barack.obama@example.com an invoice." },
    ];
    expect(assessLeakage(scrub(docs, detectPii(docs, { selfTerms: [] })), []).residual).toEqual([]);
  });
  it("emits the exact Python input shape, sanitized titles, file IDs and no mapping values", async () => {
    const files = await Promise.all([
      stripAndExtract({
        name: "Alice-private.txt",
        type: "text/plain",
        bytes: encode("Barack Obama approved this."),
      }),
      stripAndExtract({ name: "scan.png", type: "image/png", bytes: new Uint8Array([1]) }),
      stripAndExtract({ name: "mail.eml", type: "", bytes: emailFixture() }),
    ]);
    const docs = [
      { docKey: "S", text: "I saw Barack." },
      ...files
        .filter((file) => file.text !== null)
        .map((file) => ({ docKey: file.name, text: file.text! })),
    ];
    const result = scrub(docs, detectPii(docs, { selfTerms: [] }));
    const payload = buildAnalysisPayload({
      reportId: "report",
      campaignId: "campaign",
      statementKey: "S",
      files,
      scrub: result,
    });
    expect(Object.keys(payload).sort()).toEqual(
      [
        "version",
        "report_id",
        "campaign_id",
        "language",
        "reporter_statement",
        "documents",
        "entity_legend",
        "redaction_summary",
      ].sort(),
    );
    expect(payload.documents.map((doc) => doc.doc_id)).toEqual(["D1", "D2"]);
    expect(payload.documents[1]!.anchor_date).toBe("2026-10-26");
    for (const doc of payload.documents)
      expect(Object.keys(doc).sort()).toEqual(
        ["doc_id", "title", "kind", "anchor_date", "text"].sort(),
      );
    for (const entity of payload.entity_legend) {
      expect(Object.keys(entity).sort()).toEqual(["placeholder", "type"]);
      expect(entity.placeholder).toMatch(/^[A-Z]+_\d+$/);
    }
    expect(JSON.stringify(payload)).not.toContain("Alice-private");
    expect(JSON.stringify(payload)).not.toContain("Barack");
    expect(payload.redaction_summary).toEqual(result.counts);
    expect(() =>
      buildAnalysisPayload({
        reportId: "r",
        campaignId: "c",
        statementKey: "missing",
        files,
        scrub: result,
      }),
    ).toThrow();
    expect(() =>
      buildAnalysisPayload({
        reportId: "r",
        campaignId: "c",
        statementKey: "S",
        files,
        scrub: { ...result, documents: docs.slice(0, 1) },
      }),
    ).toThrow();
  });
});
