import JSZip from "jszip";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";

export async function pdfFixture(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setAuthor("Fixture Private Author");
  pdf.setCreator("Fixture Private Creator");
  pdf.setTitle("Fixture Private Title");
  pdf.setSubject("Fixture Private Subject");
  pdf.setKeywords(["Fixture Private Keyword"]);
  pdf.setProducer("Fixture Private Producer");
  pdf.setCreationDate(new Date("2020-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2020-01-02T00:00:00Z"));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Barack Obama reviewed the invoice.", { font, x: 50, y: 700 });
  const xmp = pdf.context.stream(
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><author>Fixture Private XMP</author></x:xmpmeta>',
    { Type: "Metadata", Subtype: "XML" },
  );
  pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(xmp));
  pdf.context.trailerInfo.ID = pdf.context.obj([PDFString.of("Fixture Private ID")]);
  return pdf.save({ useObjectStreams: false });
}

export async function docxFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="custom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Barack Obama approved the invoice.</w:t></w:r><w:ins w:id="1" w:author="Private Revision Author" w:initials="PR" w:date="2026-01-01T01:02:03Z"><w:r><w:t> Approved.</w:t></w:r></w:ins></w:p></w:body></w:document>',
  );
  zip.file(
    "word/comments.xml",
    '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="Private Comment Author" w:initials="PC"><w:p><w:r><w:t>Review this.</w:t></w:r></w:p></w:comment></w:comments>',
  );
  zip.file(
    "docProps/core.xml",
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Private Creator</dc:creator><cp:lastModifiedBy>Private Editor</cp:lastModifiedBy><cp:revision>99</cp:revision></cp:coreProperties>',
  );
  zip.file(
    "docProps/app.xml",
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Private Company</Company><Manager>Private Manager</Manager><Template>Private Template</Template></Properties>',
  );
  zip.file("docProps/custom.xml", "<Properties><private>Private Custom</private></Properties>");
  zip.file("docProps/thumbnail.jpeg", new Uint8Array([1, 2, 3]));
  return zip.generateAsync({ type: "uint8array", comment: "Private ZIP Comment" });
}

export const emailFixture = (): Uint8Array =>
  new TextEncoder().encode(
    [
      "Date: Mon, 26 Oct 2026 10:00:00 +0000",
      "From: Barack Obama <barack.obama@example.com>",
      "To: Jane Doe <jane.doe@example.com>",
      "Cc: Review <review@example.com>",
      "Subject: Invoice review",
      "Received: from private-machine (192.168.12.34)",
      "\tby private-mailserver; Mon, 26 Oct 2026 10:00:00 +0000",
      "X-Originating-IP: [192.168.12.34]",
      "Message-ID: <private-message-id@example.com>",
      "X-Mailer: Private Mail Client",
      "User-Agent: Private Agent",
      "Return-Path: <private@example.com>",
      "DKIM-Signature: private-signature",
      "Authentication-Results: private-results",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Barack approved the invoice. Please call +1 415 555 2671.",
    ].join("\r\n"),
  );
