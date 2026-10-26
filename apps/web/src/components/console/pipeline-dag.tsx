"use client";

import { Check, Cpu, Sparkles, TriangleAlert, X } from "lucide-react";

import { Spinner } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { stageDependencies, stageMeta } from "@/lib/evidence";
import { formatDuration } from "@/lib/format";
import type { StageRun } from "@/lib/types";

export type StageState = {
  status: "pending" | "started" | "succeeded" | "degraded" | "failed";
  detail?: string;
  model?: string | null;
  durationMs?: number;
  calls?: number;
  repairs?: number;
};

const columns: string[][] = [
  ["segment"],
  ["injection_scan"],
  ["extract"],
  ["consolidate"],
  ["ground", "temporal", "entities"],
  ["verify"],
  ["contradictions"],
  ["calibrate"],
  ["gaps"],
  ["brief"],
];

export function stageStatesFromRuns(runs: StageRun[]): Record<string, StageState> {
  return Object.fromEntries(
    runs.map((run) => [
      run.stage,
      {
        status: run.status === "skipped" ? "pending" : run.status,
        detail: run.notes.join("; "),
        model: run.model || null,
        durationMs: run.duration_ms,
        calls: run.llm_calls,
        repairs: run.repairs,
      } satisfies StageState,
    ]),
  );
}

function StatusIcon({ status }: { status: StageState["status"] }) {
  if (status === "started") return <Spinner className="size-3.5 text-seal" />;
  if (status === "succeeded")
    return <Check className="size-3.5 text-documented" aria-hidden="true" />;
  if (status === "degraded")
    return <TriangleAlert className="size-3.5 text-allegation" aria-hidden="true" />;
  if (status === "failed") return <X className="size-3.5 text-contradicted" aria-hidden="true" />;
  return <span className="size-2 rounded-full bg-line-strong" aria-hidden="true" />;
}

const statusText: Record<StageState["status"], string> = {
  pending: "Waiting",
  started: "Running",
  succeeded: "Done",
  degraded: "Degraded",
  failed: "Failed",
};

function StageNode({ stage, state }: { stage: string; state: StageState | undefined }) {
  const meta = stageMeta[stage];
  const status = state?.status ?? "pending";
  const Kind = meta?.kind === "llm" ? Sparkles : Cpu;
  return (
    <li
      className={cn(
        "relative flex min-h-[92px] flex-col gap-1 rounded-lg border bg-bg p-3 transition-[border-color,background-color] duration-200",
        status === "started" && "animate-[pulse-ring_1.4s_ease-out_infinite] border-seal",
        status === "succeeded" && "border-line",
        status === "degraded" && "border-allegation/60 bg-allegation-soft/40",
        status === "failed" && "border-contradicted/60 bg-contradicted-soft/40",
        status === "pending" && "border-dashed border-line-strong",
      )}
      aria-label={`${meta?.label ?? stage}: ${statusText[status]}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Kind
            className={cn("size-3.5", meta?.kind === "llm" ? "text-seal" : "text-ink-3")}
            aria-hidden="true"
          />
          {meta?.label ?? stage}
        </span>
        <StatusIcon status={status} />
      </div>
      <p className="text-xs leading-4 text-ink-2">{meta?.blurb}</p>
      {state?.durationMs !== undefined && status !== "pending" && status !== "started" ? (
        <p className="tabular mt-auto flex flex-wrap gap-x-2 font-mono text-2xs text-ink-3">
          <span>{formatDuration(state.durationMs)}</span>
          {state.calls ? (
            <span>
              {state.calls} call{state.calls === 1 ? "" : "s"}
            </span>
          ) : null}
          {state.repairs ? <span>{state.repairs} repair</span> : null}
          {state.model ? <span className="truncate">{state.model}</span> : null}
        </p>
      ) : null}
      {state?.detail && status !== "pending" ? (
        <p className="font-mono text-2xs text-ink-3">{state.detail}</p>
      ) : null}
    </li>
  );
}

export function PipelineDag({
  states,
  className,
}: {
  states: Record<string, StageState>;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-seal" aria-hidden="true" />
          Model stage
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Cpu className="size-3.5 text-ink-3" aria-hidden="true" />
          Deterministic stage
        </span>
        <span className="text-ink-3">Stages in the same column run concurrently.</span>
      </div>
      <ol
        className="scrollbar-quiet flex snap-x gap-3 overflow-x-auto pb-2"
        aria-label="Analysis pipeline stages"
      >
        {columns.map((column, index) => (
          <li key={index} className="flex w-[200px] shrink-0 snap-start flex-col gap-3">
            <span className="tabular text-2xs text-ink-3">
              {column.length > 1
                ? "parallel"
                : `after ${(stageDependencies[column[0] ?? ""] ?? []).map((dep) => stageMeta[dep]?.label).join(" + ") || "input"}`}
            </span>
            <ul className="flex flex-col gap-3">
              {column.map((stage) => (
                <StageNode key={stage} stage={stage} state={states[stage]} />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
