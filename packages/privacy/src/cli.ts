import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

import { assessLeakage, buildAnalysisPayload, detectPii, scrub, stripAndExtract } from "./index.js";
import type { StrippedFile, TextDocument } from "./types.js";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      "self-terms": { type: "string" },
      out: { type: "string" },
      "report-id": { type: "string" },
      "campaign-id": { type: "string" },
    },
  });
  if (
    positionals.length !== 1 ||
    positionals[0] !== "scrub" ||
    !values.dir ||
    !values.out ||
    !values["self-terms"]
  )
    throw new Error("Invalid arguments");
  const input = values["self-terms"];
  const terms: unknown = JSON.parse(
    input.trim().startsWith("[") ? input : await readFile(input, "utf8"),
  );
  if (!Array.isArray(terms) || !terms.every((term: unknown) => typeof term === "string"))
    throw new Error("Invalid self terms");
  const directory = resolve(values.dir);
  const out = resolve(values.out);
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name !== "ground_truth.json" &&
        !/^README/i.test(entry.name) &&
        resolve(directory, entry.name) !== out &&
        resolve(directory, entry.name) !== resolve(input),
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const files: StrippedFile[] = [];
  const docs: TextDocument[] = [];
  const statementKey = "reporter_statement.txt";
  for (const entry of entries) {
    const bytes = new Uint8Array(await readFile(resolve(directory, entry.name)));
    const file = await stripAndExtract({ name: basename(entry.name), type: "", bytes });
    if (file.text !== null) docs.push({ docKey: entry.name, text: file.text });
    if (entry.name !== statementKey) files.push(file);
  }
  if (!docs.some((doc) => doc.docKey === statementKey)) throw new Error("Statement missing");
  const result = scrub(docs, detectPii(docs, { selfTerms: terms as string[] }));
  const payload = buildAnalysisPayload({
    reportId: values["report-id"] ?? randomUUID(),
    campaignId: values["campaign-id"] ?? "evaluation",
    statementKey,
    files,
    scrub: result,
  });
  const output = {
    payload,
    pseudonym_map: result.pseudonymMap,
    stripped_files: files.map((file) => ({
      name: file.name,
      kind: file.kind,
      metadata_before: file.metadataRemoved,
      metadata_after: file.metadataRemaining,
    })),
    leakage_estimate: assessLeakage(result, terms as string[]),
  };
  await writeFile(out, JSON.stringify(output, null, 2), { flag: "wx", mode: 0o600 });
}

main().catch(() => {
  process.stderr.write("Scrub failed: check arguments, input formats and output destination.\n");
  process.exitCode = 1;
});
