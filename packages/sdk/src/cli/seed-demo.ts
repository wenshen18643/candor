import { runDemo } from "../demo.js";
import { CandorError } from "../transport.js";

try {
  const result = await runDemo({
    apiUrl: process.env.CANDOR_API_URL ?? "http://localhost:8000",
    identityUrl: process.env.CANDOR_IDENTITY_URL ?? "http://localhost:8787",
  });
  console.log(`Codename: ${result.built.codename}`);
  console.log(`Report: ${result.submitted.report_id}`);
  console.log(`Log index: ${result.submitted.receipt.log_index}`);
  console.log(`Analysis job: ${result.jobId} (${result.jobStatus})`);
  console.log(
    result.jobStatus === "queued"
      ? "Analysis queued. No worker has claimed it; stopping without an LLM."
      : "A worker has claimed the analysis job; follow it with streamJobEvents.",
  );
} catch (error) {
  console.error(
    error instanceof CandorError
      ? error.message
      : "Demo failed; check service availability and demo configuration.",
  );
  process.exitCode = 1;
}
