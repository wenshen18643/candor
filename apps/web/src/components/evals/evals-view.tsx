"use client";

import { FlaskConical, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import sampleData from "@/data/evals-sample.json";
import { formatDateTime } from "@/lib/format";

import { BenchSection } from "./bench-section";
import type { BenchSummary, EvalsSummary } from "./model";
import { ResultsMatrix } from "./results-matrix";
import { ScenarioTable } from "./scenario-table";

type Source<T> =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

const sample = sampleData as unknown as { evals: EvalsSummary; bench: BenchSummary };

async function load<T>(path: string, valid: (value: unknown) => boolean): Promise<Source<T>> {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (response.status === 404) return { status: "missing" };
    if (!response.ok) return { status: "error", message: `${path} answered ${response.status}.` };
    const data: unknown = await response.json();
    if (!valid(data))
      return { status: "error", message: `${path} does not have the expected shape.` };
    return { status: "ok", data: data as T };
  } catch {
    return { status: "error", message: `${path} could not be read.` };
  }
}

const isEvals = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as EvalsSummary).scenarios) &&
  typeof (value as EvalsSummary).aggregate === "object";
const isBench = (value: unknown) =>
  typeof value === "object" && value !== null && Array.isArray((value as BenchSummary).results);

const runCommands = [
  "cd services/evals",
  "uv run candor-evals synth",
  "uv run candor-evals run --provider codex --scenarios all --samples 3 --chaos 0.3",
];
const benchCommand = "uv run candor-evals bench --providers codex:gpt-6.1-sol,meta:muse-spark-1.3";

export function EvalsView() {
  const [evals, setEvals] = useState<Source<EvalsSummary>>({ status: "loading" });
  const [bench, setBench] = useState<Source<BenchSummary>>({ status: "loading" });
  const [showSample, setShowSample] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      load<EvalsSummary>("/data/evals-latest.json", isEvals),
      load<BenchSummary>("/data/bench-latest.json", isBench),
    ]).then(([evalsSource, benchSource]) => {
      if (cancelled) return;
      setEvals(evalsSource);
      setBench(benchSource);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (evals.status === "loading" || bench.status === "loading") return <LoadingState />;

  const realEvals = evals.status === "ok" ? evals.data : null;
  const realBench = bench.status === "ok" ? bench.data : null;
  const noRealData = !realEvals && !realBench;
  const usingSample = noRealData && showSample;
  const shownEvals = usingSample ? sample.evals : realEvals;
  const shownBench = usingSample ? sample.bench : realBench;
  const errors = [evals, bench].flatMap((source) =>
    source.status === "error" ? [source.message] : [],
  );

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 pb-24 sm:px-8">
      {usingSample ? (
        <div
          role="status"
          className="sticky top-0 z-30 -mx-5 mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-allegation/30 bg-allegation-soft px-5 py-2.5 sm:-mx-8 sm:px-8"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-allegation">
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            SAMPLE DATA. Invented numbers that preview the layout. These are not results.
          </p>
          <button
            type="button"
            onClick={() => setShowSample(false)}
            className="cursor-pointer rounded-md px-2 py-1 text-sm text-allegation underline underline-offset-4 hover:bg-allegation/10"
          >
            Hide sample
          </button>
        </div>
      ) : null}

      <header className="flex flex-col gap-4 pt-8 pb-10 sm:pt-12">
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          Evaluation
          {usingSample ? <SampleBadge /> : null}
        </h1>
        <p className="max-w-[68ch] text-md text-ink-2">
          Candor is tested on six synthetic whistleblowing cases with planted identifiers,
          contradictions, date puzzles and prompt injections. Results here are read from files
          written by the evaluation harness, never typed in by hand
          {usingSample ? "; the numbers shown right now are an invented sample." : "."}
        </p>
        {shownEvals || shownBench ? (
          <RunMeta evals={shownEvals} bench={shownBench} sample={usingSample} />
        ) : null}
        {errors.length ? (
          <p className="text-sm text-contradicted" role="alert">
            {errors.join(" ")}
          </p>
        ) : null}
      </header>

      {noRealData ? (
        <EmptyState showSample={showSample} onShowSample={setShowSample} compact={usingSample} />
      ) : null}

      {shownEvals ? (
        <>
          <Section
            id="results"
            title="Results against targets"
            description="The four concerns from the product brief, plus injection robustness and reasoning quality."
            sample={usingSample}
          >
            <ResultsMatrix summary={shownEvals} />
          </Section>
          <Section
            id="scenarios"
            title="Per scenario"
            description="The same metrics for each case, so one strong scenario cannot hide a weak one."
            sample={usingSample}
          >
            <ScenarioTable summary={shownEvals} />
          </Section>
        </>
      ) : realBench ? (
        <Section id="results" title="Results against targets" sample={false}>
          <MissingFile
            file="evals-latest.json"
            commands={runCommands}
            note="The benchmark below is real; the quality evaluation has not been run yet."
          />
        </Section>
      ) : null}

      {shownBench ? (
        <Section
          id="benchmark"
          title="Model benchmark"
          description="Quality against cost and latency for each pipeline stage. Points on the Pareto front are not beaten on all three at once."
          sample={usingSample}
        >
          <BenchSection bench={shownBench} sample={usingSample} />
        </Section>
      ) : realEvals ? (
        <Section id="benchmark" title="Model benchmark" sample={false}>
          <MissingFile
            file="bench-latest.json"
            commands={["cd services/evals", benchCommand]}
            note="Providers without credentials are skipped and listed with the reason."
          />
        </Section>
      ) : null}

      {shownEvals?.methodology ? (
        <section aria-labelledby="method-heading" className="mt-16 border-t border-line pt-8">
          <h2 id="method-heading" className="text-md font-semibold">
            Method
          </h2>
          <ul className="mt-3 grid max-w-[900px] gap-x-10 gap-y-2 text-sm text-ink-2 md:grid-cols-2">
            {Object.entries(shownEvals.methodology).map(([key, value]) => (
              <li key={key}>
                <span className="font-medium text-ink capitalize">{key}.</span> {value}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function SampleBadge() {
  return (
    <Badge tone="allegation" className="h-6 px-2.5 text-xs">
      <TriangleAlert aria-hidden="true" />
      SAMPLE
    </Badge>
  );
}

function Section({
  id,
  title,
  description,
  sample,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  sample: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="mt-14 flex flex-col gap-5 first-of-type:mt-0"
    >
      <div className="flex flex-col gap-1">
        <h2
          id={`${id}-heading`}
          className="flex flex-wrap items-center gap-2 text-xl font-semibold"
        >
          {title}
          {sample ? <SampleBadge /> : null}
        </h2>
        {description ? <p className="max-w-[72ch] text-sm text-ink-2">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function RunMeta({
  evals,
  bench,
  sample,
}: {
  evals: EvalsSummary | null;
  bench: BenchSummary | null;
  sample: boolean;
}) {
  const items: { label: string; value: ReactNode }[] = [];
  if (evals) {
    items.push({
      label: "Model under test",
      value: (
        <span className="font-mono text-xs">
          {evals.provider}:{evals.model}
        </span>
      ),
    });
    items.push({ label: "Evaluated", value: formatDateTime(evals.generated_at) });
    const total = evals.aggregate.scenarios_total ?? evals.scenarios.length;
    const failed = evals.aggregate.scenarios_failed ?? 0;
    items.push({
      label: "Scenarios",
      value: `${total} run${failed ? `, ${failed} with failures` : ", all completed"}`,
    });
    if (typeof evals.chaos.probability === "number")
      items.push({ label: "Chaos probability", value: `p = ${evals.chaos.probability}` });
  }
  if (bench) items.push({ label: "Benchmarked", value: formatDateTime(bench.generated_at) });
  return (
    <dl
      className={
        sample
          ? "flex flex-wrap gap-x-8 gap-y-2 rounded-lg border border-dashed border-allegation/50 px-4 py-3"
          : "flex flex-wrap gap-x-8 gap-y-2 rounded-lg bg-surface px-4 py-3"
      }
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-col">
          <dt className="text-xs text-ink-2">{item.label}</dt>
          <dd className="tabular text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Commands({ lines }: { lines: string[] }) {
  return (
    <pre className="scrollbar-quiet overflow-x-auto rounded-lg bg-surface-2 px-4 py-3 font-mono text-xs leading-6 text-ink">
      {lines.map((line) => (
        <span key={line} className="block">
          <span className="text-ink-3 select-none">$ </span>
          {line}
        </span>
      ))}
    </pre>
  );
}

function MissingFile({ file, commands, note }: { file: string; commands: string[]; note: string }) {
  return (
    <div className="flex max-w-[760px] flex-col gap-3 rounded-lg border border-line px-5 py-4">
      <p className="text-sm text-ink">
        <span className="font-mono text-xs">/data/{file}</span> has not been generated yet.
      </p>
      <Commands lines={commands} />
      <p className="text-sm text-ink-2">{note}</p>
    </div>
  );
}

const concerns = [
  [
    "Identifier leakage",
    "Canary hits in the payload, prompts, file metadata and results. Target 0.",
  ],
  ["Source traceability", "Event recall, claim precision, quote grounding and citation precision."],
  ["Timeline accuracy", "Kendall τ-b, date error in days, interval coverage, conflict recall."],
  [
    "Invalid-output handling",
    "A chaos provider corrupts 30% of model outputs; results must stay valid.",
  ],
  [
    "Injection robustness",
    "Planted instructions must be quarantined and must not steer the brief.",
  ],
  ["Contradictions and gaps", "Planted contradictions found; follow-up questions cover the gaps."],
];

function EmptyState({
  showSample,
  onShowSample,
  compact,
}: {
  showSample: boolean;
  onShowSample: (value: boolean) => void;
  compact: boolean;
}) {
  if (compact)
    return (
      <div className="mb-12 flex flex-col gap-3 rounded-lg border border-line px-5 py-4">
        <p className="text-sm text-ink-2">
          No real results exist in this build yet. Run{" "}
          <span className="font-mono text-xs text-ink">candor-evals run</span> and{" "}
          <span className="font-mono text-xs text-ink">candor-evals bench</span> to replace the
          sample.
        </p>
        <ToggleSwitch
          id="sample-toggle"
          tone="allegation"
          checked={showSample}
          onCheckedChange={onShowSample}
          label="View sample layout"
        />
      </div>
    );
  return (
    <section
      aria-labelledby="empty-heading"
      className="grid gap-10 rounded-xl border border-line px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <FlaskConical className="size-6 text-ink-2" aria-hidden="true" />
        <h2 id="empty-heading" className="text-xl font-semibold">
          No evaluation results yet
        </h2>
        <p className="max-w-[60ch] text-base text-ink-2">
          This page reads{" "}
          <span className="font-mono text-xs text-ink">/data/evals-latest.json</span> and{" "}
          <span className="font-mono text-xs text-ink">/data/bench-latest.json</span>. Neither file
          exists in this build, so there is nothing to report. Run the harness to create them:
        </p>
        <Commands lines={[...runCommands, benchCommand]} />
        <p className="max-w-[60ch] text-sm text-ink-2">
          Each run copies a compact summary into{" "}
          <span className="font-mono text-xs">apps/web/public/data/</span>, and this page picks it
          up on the next load.
        </p>
        <div className="mt-2 rounded-lg bg-surface px-4 py-3">
          <ToggleSwitch
            id="sample-toggle"
            tone="allegation"
            checked={showSample}
            onCheckedChange={onShowSample}
            label="View sample layout"
            description="Fills the page with invented numbers, clearly marked SAMPLE, to show how results will look. They are never results."
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="text-base font-semibold">What will appear here</h3>
        <dl className="flex flex-col divide-y divide-line border-y border-line">
          {concerns.map(([title, text]) => (
            <div key={title} className="flex flex-col gap-0.5 py-2.5">
              <dt className="text-sm font-medium text-ink">{title}</dt>
              <dd className="text-sm text-ink-2">{text}</dd>
            </div>
          ))}
          <div className="flex flex-col gap-0.5 py-2.5">
            <dt className="text-sm font-medium text-ink">Model benchmark</dt>
            <dd className="text-sm text-ink-2">
              Quality, cost and latency per stage, the Pareto front, and the provider the router
              picks for each stage.
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 pt-12 sm:px-8" role="status">
      <span className="sr-only">Loading evaluation results</span>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-4 h-5 w-full max-w-[560px]" />
      <Skeleton className="mt-10 h-80 w-full rounded-xl" />
    </div>
  );
}
