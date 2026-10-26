import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { expect, it } from "vitest";

import type { AnalysisPayload } from "../src/index.js";
import { docxFixture, emailFixture, pdfFixture } from "./fixtures.js";

function runCli(args: string[]): Promise<{ code: number; output: string; errors: string }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../dist/cli.js", import.meta.url), {
      argv: args,
      stdout: true,
      stderr: true,
      execArgv: [],
    });
    let output = "";
    let errors = "";
    worker.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    worker.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    worker.on("error", reject);
    worker.on("exit", (code) => resolve({ code, output, errors }));
  });
}

it("runs the built CLI on a realistic temporary scenario, keeps stdout empty and refuses overwrites", async () => {
  const directory = await mkdtemp(join(tmpdir(), "candor-privacy-test-"));
  try {
    await Promise.all([
      writeFile(
        join(directory, "reporter_statement.txt"),
        "I am Alice Smith. Barack Obama altered the invoice.",
      ),
      writeFile(join(directory, "a.pdf"), await pdfFixture()),
      writeFile(join(directory, "b.docx"), await docxFixture()),
      writeFile(join(directory, "c.eml"), emailFixture()),
      writeFile(join(directory, "ground_truth.json"), '{"private":"Ground truth excluded"}'),
      writeFile(join(directory, "README.md"), "Readme excluded"),
      writeFile(join(directory, "terms.json"), '["Alice Smith"]'),
    ]);
    const out = join(directory, "output.json");
    const args = [
      "scrub",
      "--dir",
      directory,
      "--self-terms",
      join(directory, "terms.json"),
      "--out",
      out,
      "--report-id",
      "00000000-0000-4000-8000-000000000001",
      "--campaign-id",
      "test-campaign",
    ];
    const execution = await runCli(args);
    expect(execution).toEqual({ code: 0, output: "", errors: "" });
    const output = JSON.parse(await readFile(out, "utf8")) as {
      payload: AnalysisPayload;
      pseudonym_map: unknown[];
      stripped_files: { name: string; metadata_after: unknown[] }[];
      leakage_estimate: { score: number };
    };
    expect(output.payload.report_id).toBe("00000000-0000-4000-8000-000000000001");
    expect(output.payload.campaign_id).toBe("test-campaign");
    expect(output.payload.documents.map((doc) => doc.doc_id)).toEqual(["D1", "D2", "D3"]);
    expect(output.stripped_files.map((file) => file.name)).toEqual(["a.pdf", "b.docx", "c.eml"]);
    expect(output.stripped_files.every((file) => file.metadata_after.length === 0)).toBe(true);
    expect(output.payload.reporter_statement).toContain("[REDACTED]");
    expect(JSON.stringify(output.payload)).not.toMatch(
      /Alice|Smith|Barack|Obama|Ground truth|Readme/,
    );
    expect(output.pseudonym_map.length).toBeGreaterThan(0);
    expect(output.leakage_estimate.score).toBeGreaterThanOrEqual(0);
    const original = await readFile(out, "utf8");
    const repeated = await runCli(args);
    expect(repeated.code).toBe(1);
    expect(repeated.output).toBe("");
    expect(repeated.errors).not.toMatch(/Alice|Smith|Barack|Obama/);
    expect(await readFile(out, "utf8")).toBe(original);
    expect((await readdir(directory)).length).toBe(8);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

it("CLI reports missing inputs without echoing identifiers or arguments", async () => {
  const result = await runCli(["scrub", "--self-terms", '["Private Secret"]']);
  expect(result.code).toBe(1);
  expect(result.output).toBe("");
  expect(result.errors).not.toContain("Private Secret");
});
