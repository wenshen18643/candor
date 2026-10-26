"use client";

import { useState } from "react";

import { ConfidenceMeter, EvidenceClassBadge, VerdictBadge } from "@/components/evidence/badges";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { confidenceLabel, evidenceClassMeta, stageDependencies, stageMeta } from "@/lib/evidence";
import { formatDuration } from "@/lib/format";
import type { StageName } from "@/lib/types";

import type { ClaimTrace, StageStat } from "./pipeline-data";
import { stageDetail } from "./pipeline-data";
import { PipelineGraph, PipelineLegend } from "./pipeline-graph";

export function PipelineExplorer({
  stats,
  trace,
  initial = "ground",
}: {
  stats: Record<string, StageStat>;
  trace?: ClaimTrace | null;
  initial?: StageName;
}) {
  const [selected, setSelected] = useState<StageName>(initial);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-16">
      <div className="flex flex-col gap-5 lg:sticky lg:top-8 lg:self-start">
        <PipelineLegend />
        <PipelineGraph selected={selected} onSelect={setSelected} />
      </div>
      <div className="flex min-w-0 flex-col gap-10">
        <StageCard stage={selected} stat={stats[selected]} onSelect={setSelected} />
        {trace ? <TraceView trace={trace} selected={selected} onSelect={setSelected} /> : null}
      </div>
    </div>
  );
}

function StageCard({
  stage,
  stat,
  onSelect,
}: {
  stage: StageName;
  stat: StageStat | undefined;
  onSelect: (stage: StageName) => void;
}) {
  const meta = stageMeta[stage];
  const detail = stageDetail[stage];
  const deps = (stageDependencies[stage] ?? []) as StageName[];
  const model = meta?.kind === "llm";
  return (
    <section
      aria-live="polite"
      aria-label="Selected stage"
      className="rounded-xl bg-bg p-5 sm:p-6 dark:bg-surface-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-lg font-semibold">{meta?.label ?? stage}</h3>
        <Badge tone={model ? "seal" : "outline"}>{model ? "Model call" : "Deterministic"}</Badge>
        <span className="text-sm text-ink-2">{detail.calls}</span>
      </div>
      <p className="mt-3 max-w-[68ch] text-base text-ink">{detail.algorithm}</p>
      <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-ink-2">Runs after</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {deps.length === 0 ? (
              <span className="text-ink-2">Nothing: it is the first stage</span>
            ) : (
              deps.map((dep) => (
                <button
                  key={dep}
                  type="button"
                  onClick={() => onSelect(dep)}
                  className="cursor-pointer rounded-sm bg-surface-2 px-1.5 py-0.5 text-ink transition-colors duration-150 hover:bg-surface-3"
                >
                  {stageMeta[dep]?.label ?? dep}
                </button>
              ))
            )}
          </dd>
        </div>
        {stat ? (
          <div>
            <dt className="text-xs text-ink-2">In the recorded demo run</dt>
            <dd className="tabular mt-1 text-ink">
              {formatDuration(stat.durationMs)}
              {stat.llmCalls > 0
                ? ` · ${stat.llmCalls} model call${stat.llmCalls === 1 ? "" : "s"}`
                : " · no model"}
              {stat.repairs > 0
                ? ` · ${stat.repairs} schema repair${stat.repairs === 1 ? "" : "s"}`
                : ""}
              {stat.notes[0] ? <span className="block text-ink-2">{stat.notes[0]}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

const traceSteps: { title: string; stage: StageName }[] = [
  { title: "Quote", stage: "extract" },
  { title: "Verbatim match", stage: "ground" },
  { title: "Verifier verdict", stage: "verify" },
  { title: "Calibrated confidence", stage: "calibrate" },
  { title: "Evidence class", stage: "calibrate" },
];

function fixed(value: number, digits = 2) {
  return value.toFixed(digits).replace("-", "−");
}

function TraceView({
  trace,
  selected,
  onSelect,
}: {
  trace: ClaimTrace;
  selected: StageName;
  onSelect: (stage: StageName) => void;
}) {
  const primary = trace.citations[0];
  const confidence = {
    score: trace.score,
    sample_agreement: trace.agreement,
    independent_sources: trace.sources,
    label: trace.label,
    statement: trace.confidenceStatement,
  };
  const bodies = [
    <div key="quote">
      <blockquote className="text-base text-ink">“{primary?.quote}”</blockquote>
      <p className="mt-1.5 text-sm text-ink-2">
        {trace.agreeing} of {trace.samples} independent extraction samples produced this claim.
      </p>
    </div>,
    <ul key="match" className="flex flex-col gap-3">
      {trace.citations.map((citation) => (
        <li key={citation.passageId}>
          <p className="rounded-md bg-surface-2 px-3 py-2 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-ink-2">
            {citation.text.slice(0, citation.start)}
            <mark className="rounded-xs bg-documented-soft text-documented underline decoration-documented/50 underline-offset-2">
              {citation.text.slice(citation.start, citation.end)}
            </mark>
            {citation.text.slice(citation.end)}
          </p>
          <p className="mt-1 text-xs text-ink-2">
            <span className="font-mono text-ink">{citation.passageId}</span> · {citation.docLabel} ·
            characters{" "}
            <span className="tabular">
              {citation.start}–{citation.end}
            </span>{" "}
            · {citation.exact ? "exact match" : "match after normalising"}
          </p>
        </li>
      ))}
    </ul>,
    <div key="verdict" className="flex flex-col items-start gap-2">
      <VerdictBadge value={trace.verdict} />
      <p className="text-sm text-ink">{trace.rationale}</p>
      <p className="text-xs text-ink-2">
        Judged against {trace.checked.join(" and ")} only, by a separate prompt at temperature 0.
      </p>
    </div>,
    <div key="confidence" className="flex flex-col gap-2.5">
      <p className="overflow-x-auto font-mono text-xs leading-5 whitespace-nowrap text-ink-2">
        σ(−1.6 + 2.2×{fixed(trace.agreement)} + 1.8×{fixed(trace.verdictWeight, 1)} + 0.45×
        {Math.min(trace.sources, 3)} − 1.2×{Number(trace.contradicted)} − 1.5×
        {Number(trace.injected)})
        <br />= σ({fixed(trace.logit)}) = <span className="text-ink">{fixed(trace.score)}</span>
      </p>
      <div className="flex items-center gap-3">
        <ConfidenceMeter confidence={confidence} />
        <span className="text-sm text-ink">{confidenceLabel[trace.label]}</span>
      </div>
    </div>,
    <div key="class" className="flex flex-col items-start gap-2">
      <EvidenceClassBadge value={trace.evidenceClass} />
      <p className="text-sm text-ink">
        {trace.sources} independent documents carry a verified quote and the verdict is supported,
        which the fixed rules class as {evidenceClassMeta[trace.evidenceClass].label.toLowerCase()}.
        The class describes the evidence, not anyone&rsquo;s intent; that judgement stays with the
        reviewer.
      </p>
    </div>,
  ];

  return (
    <section aria-labelledby="trace-title">
      <h3 id="trace-title" className="text-lg font-semibold">
        One claim, traced
      </h3>
      <p className="mt-1.5 max-w-[68ch] text-base text-ink-2">
        Claim <span className="font-mono text-ink">{trace.claimId}</span>, from the email at the top
        of this page as the pipeline sees it: {trace.statement}
      </p>
      <ol className="mt-5 flex flex-col">
        {traceSteps.map((step, index) => {
          const active = selected === step.stage;
          return (
            <li key={step.title} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
              <span
                className={cn(
                  "tabular relative z-10 mt-0.5 flex size-7 items-center justify-center rounded-full font-mono text-xs transition-colors duration-150",
                  active ? "bg-seal text-on-seal" : "bg-surface-3 text-ink-2",
                )}
                aria-hidden="true"
              >
                {index + 1}
              </span>
              {index < traceSteps.length - 1 ? (
                <span
                  className="absolute top-8 bottom-1 left-[0.8125rem] w-px bg-line-strong"
                  aria-hidden="true"
                />
              ) : null}
              <div className="min-w-0 pb-7">
                <button
                  type="button"
                  onClick={() => onSelect(step.stage)}
                  aria-pressed={active}
                  className="flex cursor-pointer flex-wrap items-baseline gap-x-2 rounded-xs text-left"
                >
                  <span className="text-base font-semibold text-ink">{step.title}</span>
                  <span
                    className={cn(
                      "text-sm underline-offset-4 hover:underline",
                      active ? "text-seal-ink" : "text-ink-2",
                    )}
                  >
                    {stageMeta[step.stage]?.label} stage
                  </span>
                </button>
                <div className="mt-2">{bodies[index]}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
