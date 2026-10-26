import { buildTrace, stageStats } from "./pipeline-data";
import { PipelineExplorer } from "./pipeline-explorer";

export function PipelineSection() {
  const trace = buildTrace("C004");
  return (
    <section aria-labelledby="pipeline-title" className="bg-surface">
      <div className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
        <div className="max-w-[68ch]">
          <h2 id="pipeline-title" className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
            Analysis you can check, line by line
          </h2>
          <p className="mt-4 text-md text-ink-2">
            Candor never asks a model to summarise and hope. Twelve stages extract claims three
            times over, match every quote character by character, have a separate verifier judge
            each claim against only its cited text, solve the timeline as a constraint problem and
            calibrate confidence. Model stages run on Meta Muse Spark through the Meta Model API, or
            on whichever provider the benchmark routes them to. Everything that can be code is code.
          </p>
        </div>
        <div className="mt-12">
          <PipelineExplorer stats={stageStats()} trace={trace} initial="ground" />
        </div>
      </div>
    </section>
  );
}
