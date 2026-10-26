import { checkBrowserCrypto } from "../../crypto/tests/browser-smoke.js";
import * as p from "../src/index.js";
import { docxFixture, emailFixture, pdfFixture } from "./fixtures.js";

export async function runBrowserChecks(): Promise<{ crypto: number; privacy: number }> {
  const cryptography = await checkBrowserCrypto();
  let checks = 0;
  const assert = (condition: boolean): void => {
    if (!condition) throw new Error("Browser privacy assertion failed");
    checks++;
  };
  for (const [name, bytes] of [
    ["test.pdf", await pdfFixture()],
    ["test.docx", await docxFixture()],
    ["test.eml", emailFixture()],
  ] as const) {
    const file = await p.stripAndExtract({ name, type: "", bytes });
    assert(file.text !== null && file.text.includes("Barack"));
    assert(file.metadataRemoved.length > 0 && file.metadataRemaining.length === 0);
  }
  const canvas = new OffscreenCanvas(2, 2);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "red";
  context.fillRect(0, 0, 2, 2);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const image = await p.stripAndExtract({
    name: "image.png",
    type: "image/png",
    bytes: new Uint8Array(await blob.arrayBuffer()),
  });
  assert(
    image.kind === "image" && image.metadataRemaining.length === 0 && image.mime === "image/png",
  );
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(image.bytes)]));
  assert(bitmap.width === 2 && bitmap.height === 2);
  bitmap.close();
  const docs = [
    { docKey: "S", text: "Alice Smith saw Barack Obama. Contact barack.obama@example.com." },
  ];
  const result = p.scrub(docs, p.detectPii(docs, { selfTerms: ["Alice Smith"] }));
  assert(result.documents[0]!.text.includes("[REDACTED]"));
  assert(!/Alice|Smith|Barack|Obama|example\.com/.test(result.documents[0]!.text));
  assert(p.assessLeakage(result, ["Alice Smith"]).score === 0);
  return { crypto: cryptography, privacy: checks };
}
