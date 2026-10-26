import { CircleX } from "lucide-react";

import { cn } from "@/lib/cn";

import {
  type EvalsSummary,
  formatValue,
  type MetricDef,
  metricGroups,
  type ScenarioScore,
  statusOf,
} from "./model";

const columns: { key: string; short: string }[] = [
  { key: "metrics.event_recall", short: "Recall" },
  { key: "metrics.claim_precision", short: "Precision" },
  { key: "metrics.quote_grounding_rate", short: "Grounding" },
  { key: "metrics.citation_precision", short: "Citations" },
  { key: "metrics.kendall_tau_b", short: "τ-b" },
  { key: "metrics.date_mae_days", short: "Date error" },
  { key: "metrics.interval_coverage", short: "Coverage" },
  { key: "metrics.contradiction_recall", short: "Contradictions" },
  { key: "metrics.gap_coverage", short: "Gaps" },
  { key: "injection.injected_passages_flagged_rate", short: "Injection flagged" },
  { key: "injection.attack_success_rate", short: "Attack success" },
  { key: "chaos.schema_valid_final_result_rate", short: "Valid under chaos" },
];

const leakColumn: MetricDef = {
  key: "leakage.total",
  label: "Identifier leaks, all surfaces",
  hint: "",
  format: "count",
  target: { op: "eq", value: 0, source: "spec" },
  aggregate: (summary) => summary.leakage.total ?? null,
  perScenario: (scenario: ScenarioScore) => scenario.leakage.total ?? null,
};

export function ScenarioTable({ summary }: { summary: EvalsSummary }) {
  const all = new Map(metricGroups.flatMap((group) => group.metrics).map((m) => [m.key, m]));
  const defs = [
    ...columns
      .map((column) => ({ column, metric: all.get(column.key) }))
      .filter((item): item is { column: { key: string; short: string }; metric: MetricDef } =>
        Boolean(item.metric),
      ),
    { column: { key: leakColumn.key, short: "Leaks" }, metric: leakColumn },
  ];

  return (
    <div
      className="scrollbar-quiet relative overflow-x-auto rounded-lg border border-line"
      tabIndex={0}
      role="region"
      aria-label="Per scenario results, scrollable"
    >
      <table className="w-full min-w-[1080px] border-collapse text-left">
        <caption className="sr-only">
          Metrics for each synthetic scenario. Values that miss their target are marked.
        </caption>
        <thead className="bg-surface text-xs text-ink-2">
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-2 font-medium">
              Scenario
            </th>
            {defs.map(({ column, metric }) => (
              <th
                key={column.key}
                scope="col"
                className="px-2.5 py-2 text-right font-medium whitespace-nowrap"
              >
                <abbr title={metric.label} className="no-underline">
                  {column.short}
                </abbr>
              </th>
            ))}
            <th scope="col" className="px-3 py-2 font-medium">
              Run
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.scenarios.map((scenario) => (
            <tr key={scenario.scenario_id} className="border-t border-line">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-bg px-4 py-2.5 text-left align-top font-normal"
              >
                <span className="block text-sm font-medium whitespace-nowrap text-ink">
                  {scenario.title}
                </span>
                <span className="block font-mono text-2xs text-ink-3">
                  {scenario.metrics.events_total ?? "?"} events ·{" "}
                  {scenario.metrics.claims_total ?? "?"} claims
                </span>
              </th>
              {defs.map(({ column, metric }) => {
                const value = metric.perScenario(scenario);
                const status = statusOf(value, metric.target);
                return (
                  <td
                    key={column.key}
                    className={cn(
                      "tabular px-2.5 py-2.5 text-right align-top text-sm whitespace-nowrap",
                      status === "misses" && "text-contradicted",
                      status === "unmeasured" && "text-ink-3",
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {status === "misses" ? (
                        <CircleX className="size-3 shrink-0" aria-hidden="true" />
                      ) : null}
                      {formatValue(value, metric.format)}
                      {status === "misses" ? (
                        <span className="sr-only">, misses target</span>
                      ) : null}
                    </span>
                  </td>
                );
              })}
              <td className="px-3 py-2.5 align-top text-sm whitespace-nowrap text-ink-2">
                {scenario.failures.length ? (
                  <span className="text-contradicted" title={scenario.failures.join("; ")}>
                    {scenario.failures.length} failed
                  </span>
                ) : (
                  "Completed"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
