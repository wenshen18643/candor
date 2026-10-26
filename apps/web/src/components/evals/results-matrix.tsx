import { CircleCheck, CircleMinus, CircleX } from "lucide-react";

import { cn } from "@/lib/cn";

import {
  type EvalsSummary,
  formatTarget,
  formatValue,
  metricGroups,
  type Status,
  statusOf,
} from "./model";
import { StripPlot } from "./strip-plot";

export function StatusMark({ status, compact = false }: { status: Status; compact?: boolean }) {
  if (status === "meets")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-documented">
        <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
        {compact ? <span className="sr-only">Meets target</span> : "Meets target"}
      </span>
    );
  if (status === "misses")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-contradicted">
        <CircleX className="size-3.5 shrink-0" aria-hidden="true" />
        {compact ? <span className="sr-only">Misses target</span> : "Misses target"}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-ink-3">
      <CircleMinus className="size-3.5 shrink-0" aria-hidden="true" />
      {compact ? <span className="sr-only">Not measurable</span> : "Not measurable"}
    </span>
  );
}

export function ResultsMatrix({ summary }: { summary: EvalsSummary }) {
  const totals = metricGroups
    .flatMap((group) => group.metrics)
    .map((metric) => statusOf(metric.aggregate(summary), metric.target));
  const meets = totals.filter((status) => status === "meets").length;
  const misses = totals.filter((status) => status === "misses").length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">
        <span className="tabular font-medium text-ink">{meets}</span> of{" "}
        <span className="tabular">{totals.length}</span> metrics meet their target
        {misses ? (
          <>
            , <span className="tabular font-medium text-contradicted">{misses}</span> miss
          </>
        ) : null}
        . Values are macro means over scenarios; the strip shows each scenario, with the dashed line
        at the target.
      </p>
      <div
        className="scrollbar-quiet relative overflow-x-auto rounded-lg border border-line"
        tabIndex={0}
        role="region"
        aria-label="Results against targets, scrollable"
      >
        <table className="w-full min-w-[760px] border-collapse text-left">
          <caption className="sr-only">
            Evaluation results by concern, with targets and pass or fail status
          </caption>
          <thead className="bg-surface text-xs text-ink-2">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Metric
              </th>
              <th scope="col" className="w-28 px-3 py-2 text-right font-medium">
                Result
              </th>
              <th scope="col" className="w-[200px] px-3 py-2 font-medium">
                Per scenario
              </th>
              <th scope="col" className="w-28 px-3 py-2 font-medium">
                Target
              </th>
              <th scope="col" className="w-36 px-3 py-2 font-medium">
                Status
              </th>
            </tr>
          </thead>
          {metricGroups.map((group) => (
            <tbody key={group.id} className="border-t border-line">
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={5}
                  className="bg-bg px-4 pt-4 pb-1.5 text-left align-bottom font-normal"
                >
                  <span className="block text-base font-semibold text-ink">{group.title}</span>
                  <span className="block max-w-[80ch] text-sm text-ink-2">{group.blurb}</span>
                </th>
              </tr>
              {group.metrics.map((metric) => {
                const value = metric.aggregate(summary);
                const status = statusOf(value, metric.target);
                return (
                  <tr key={metric.key} className="border-t border-line/70">
                    <th scope="row" className="px-4 py-2 text-left align-middle font-normal">
                      <span className="block text-sm font-medium text-ink">{metric.label}</span>
                      <span className="block text-xs text-ink-2">{metric.hint}</span>
                    </th>
                    <td
                      className={cn(
                        "tabular px-3 py-2 text-right align-middle text-md font-semibold",
                        status === "misses" ? "text-contradicted" : "text-ink",
                        status === "unmeasured" && "font-normal text-ink-3",
                      )}
                    >
                      {formatValue(value, metric.format)}
                    </td>
                    <td className="px-3 py-1 align-middle">
                      <StripPlot metric={metric} scenarios={summary.scenarios} />
                    </td>
                    <td className="tabular px-3 py-2 align-middle text-sm whitespace-nowrap text-ink-2">
                      {formatTarget(metric.target, metric.format)}
                      {metric.target.source === "spec" ? (
                        <span
                          className="ml-1.5 rounded-xs border border-line-strong px-1 text-2xs text-ink-2"
                          title="Fixed by docs/specs/05-evals.md"
                        >
                          spec
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <StatusMark status={status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <p className="text-xs text-ink-2">
        Targets tagged <span className="rounded-xs border border-line-strong px-1">spec</span> are
        fixed by the evaluation spec. The others are Candor&apos;s own release bar. Strip legend:
        circle meets the target, diamond misses it.
      </p>
    </div>
  );
}
