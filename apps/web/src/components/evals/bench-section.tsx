import { scaleLinear, scaleLog } from "d3-scale";
import { CircleCheck, Route } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

import {
  type BenchPoint,
  type BenchSummary,
  formatCost,
  formatLatency,
  modelName,
  shortProvider,
  stageLabels,
} from "./model";

const width = 340;
const height = 236;
const margin = { top: 14, right: 18, bottom: 40, left: 44 };
const stages = ["extract", "verify", "gaps"];

type Scales = {
  x: (value: number) => number;
  y: (value: number) => number;
  xTicks: number[];
  yTicks: number[];
};

function buildScales(points: BenchPoint[]): Scales {
  const costs = points.map((point) => Math.max(point.cost_usd, 1e-5));
  const qualities = points.map((point) => point.quality);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const x = scaleLog()
    .domain([minCost / 1.8, maxCost * 1.8])
    .range([margin.left, width - margin.right]);
  const yMin = Math.max(0, Math.floor((Math.min(...qualities) - 0.05) * 10) / 10);
  const y = scaleLinear()
    .domain([yMin, 1])
    .range([height - margin.bottom, margin.top])
    .nice();
  const decades = x.ticks().filter((tick) => {
    const exponent = Math.log10(tick);
    const mantissa = tick / 10 ** Math.floor(exponent);
    return Math.abs(mantissa - 1) < 1e-9 || Math.abs(mantissa - 3) < 1e-9;
  });
  return {
    x: (value) => x(Math.max(value, 1e-5)),
    y: (value) => y(value),
    xTicks: decades.length >= 2 ? decades : x.ticks(3),
    yTicks: y.ticks(4),
  };
}

function formatTick(value: number) {
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value >= 0.001) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

type Placed = BenchPoint & {
  px: number;
  py: number;
  below: boolean;
  anchor: "start" | "middle" | "end";
};

function placeLabels(points: BenchPoint[], scales: Scales): Placed[] {
  const sorted = [...points].sort((a, b) => a.cost_usd - b.cost_usd);
  const placed: Placed[] = [];
  for (const point of sorted) {
    const px = scales.x(point.cost_usd);
    const py = scales.y(point.quality);
    const crowded = placed.some(
      (other) => !other.below && Math.abs(other.px - px) < 96 && Math.abs(other.py - py) < 30,
    );
    const below = crowded || py < margin.top + 30;
    const anchor =
      px > width - margin.right - 50 ? "end" : px < margin.left + 40 ? "start" : "middle";
    placed.push({ ...point, px, py, below, anchor });
  }
  return placed;
}

function StageChart({
  stage,
  points,
  scales,
  routed,
  sample,
}: {
  stage: string;
  points: BenchPoint[];
  scales: Scales;
  routed: string | undefined;
  sample: boolean;
}) {
  const placed = placeLabels(points, scales);
  const label = `${stageLabels[stage] ?? stage} stage, quality against mean cost per run on a log scale. ${points
    .map(
      (point) =>
        `${point.provider}: quality ${point.quality.toFixed(3)}, cost ${formatCost(point.cost_usd)}, p95 ${formatLatency(point.p95_latency_ms)}${point.pareto ? ", on the Pareto front" : ", dominated"}${point.provider === routed ? ", chosen by the router" : ""}`,
    )
    .join("; ")}.`;
  const plotBottom = height - margin.bottom;
  return (
    <figure className="flex w-full max-w-[440px] min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-base font-semibold">{stageLabels[stage] ?? stage}</span>
        {routed ? (
          <span className="inline-flex items-center gap-1 text-xs text-ink-2">
            <Route className="size-3" aria-hidden="true" />
            Router: <span className="font-mono text-ink">{routed}</span>
          </span>
        ) : null}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        className="h-auto w-full"
      >
        {sample ? (
          <text
            x={(margin.left + width - margin.right) / 2}
            y={(margin.top + plotBottom) / 2 + 12}
            textAnchor="middle"
            fill="var(--allegation)"
            opacity={0.14}
            style={{ fontSize: 40, fontWeight: 700, letterSpacing: "0.12em" }}
          >
            SAMPLE
          </text>
        ) : null}
        {scales.yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={margin.left}
              x2={width - margin.right}
              y1={scales.y(tick)}
              y2={scales.y(tick)}
              stroke="var(--line)"
            />
            <text
              x={margin.left - 6}
              y={scales.y(tick) + 3.5}
              textAnchor="end"
              fill="var(--ink-2)"
              style={{ fontSize: 10 }}
              className="tabular"
            >
              {tick.toFixed(1)}
            </text>
          </g>
        ))}
        {scales.xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line
              x1={scales.x(tick)}
              x2={scales.x(tick)}
              y1={margin.top}
              y2={plotBottom}
              stroke="var(--line)"
            />
            <text
              x={scales.x(tick)}
              y={plotBottom + 14}
              textAnchor="middle"
              fill="var(--ink-2)"
              style={{ fontSize: 10 }}
            >
              {formatTick(tick)}
            </text>
          </g>
        ))}
        <text
          x={(margin.left + width - margin.right) / 2}
          y={height - 6}
          textAnchor="middle"
          fill="var(--ink-2)"
          style={{ fontSize: 10 }}
        >
          Mean cost per run (USD, log scale)
        </text>
        <text
          transform={`translate(11 ${(margin.top + plotBottom) / 2}) rotate(-90)`}
          textAnchor="middle"
          fill="var(--ink-2)"
          style={{ fontSize: 10 }}
        >
          Quality
        </text>
        {placed.map((point) => {
          const isRouted = point.provider === routed;
          const clearance = isRouted ? 9.5 : 5;
          const labelY = point.below ? point.py + clearance + 12 : point.py - clearance - 17;
          return (
            <g key={point.provider}>
              {isRouted ? (
                <circle
                  cx={point.px}
                  cy={point.py}
                  r={9.5}
                  fill="none"
                  stroke="var(--seal)"
                  strokeWidth={1.5}
                />
              ) : null}
              <circle
                cx={point.px}
                cy={point.py}
                r={5}
                fill={point.pareto ? "var(--seal)" : "var(--bg)"}
                stroke={point.pareto ? "var(--seal)" : "var(--ink-3)"}
                strokeWidth={1.5}
              />
              <text
                x={point.px}
                y={labelY}
                textAnchor={point.anchor}
                fill="var(--ink)"
                style={{ fontSize: 10.5, fontWeight: 600 }}
              >
                {shortProvider(point.provider)}
              </text>
              <text
                x={point.px}
                y={labelY + 11}
                textAnchor={point.anchor}
                fill="var(--ink-2)"
                style={{ fontSize: 9.5 }}
              >
                {`p95 ${formatLatency(point.p95_latency_ms)}`}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function BenchSection({ bench, sample }: { bench: BenchSummary; sample: boolean }) {
  const scales = buildScales(bench.results.length ? bench.results : []);
  const present = stages.filter((stage) => bench.results.some((point) => point.stage === stage));
  const rows = [...bench.results].sort(
    (a, b) => stages.indexOf(a.stage) - stages.indexOf(b.stage) || b.quality - a.quality,
  );

  return (
    <div className="flex flex-col gap-8">
      {bench.results.length ? (
        <>
          <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
            {present.map((stage) => (
              <StageChart
                key={stage}
                stage={stage}
                points={bench.results.filter((point) => point.stage === stage)}
                scales={scales}
                routed={bench.router[stage]}
                sample={sample}
              />
            ))}
          </div>
          <ul
            className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-2"
            aria-label="Chart legend"
          >
            <li className="inline-flex items-center gap-1.5">
              <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                <circle cx="6" cy="6" r="4.5" fill="var(--seal)" />
              </svg>
              On the Pareto front (quality, cost, p95 latency)
            </li>
            <li className="inline-flex items-center gap-1.5">
              <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                <circle
                  cx="6"
                  cy="6"
                  r="4"
                  fill="var(--bg)"
                  stroke="var(--ink-3)"
                  strokeWidth="1.5"
                />
              </svg>
              Dominated by another provider
            </li>
            <li className="inline-flex items-center gap-1.5">
              <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--seal)" strokeWidth="1.5" />
                <circle cx="8" cy="8" r="3" fill="var(--seal)" />
              </svg>
              Chosen by the router
            </li>
          </ul>
        </>
      ) : (
        <p className="rounded-lg bg-surface px-4 py-3 text-sm text-ink-2">
          The benchmark finished without any usable provider results.
        </p>
      )}

      <div
        className="scrollbar-quiet relative overflow-x-auto rounded-lg border border-line"
        tabIndex={0}
        role="region"
        aria-label="Benchmark results table, scrollable"
      >
        <table className="w-full min-w-[820px] border-collapse text-left">
          <caption className="sr-only">
            Benchmark results per stage and provider: quality, latency, cost, Pareto status and
            router choice
          </caption>
          <thead className="bg-surface text-xs text-ink-2">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Stage
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Provider and model
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Quality
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                p50
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                p95
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Mean cost
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Runs
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Degraded
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Pareto
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Router
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((point) => {
              const routed = bench.router[point.stage] === point.provider;
              return (
                <tr
                  key={`${point.stage}-${point.provider}`}
                  className={cn("border-t border-line", routed && "bg-seal-soft/50")}
                >
                  <td className="px-4 py-2 text-sm text-ink">
                    {stageLabels[point.stage] ?? point.stage}
                  </td>
                  <td className="px-3 py-2">
                    <span className="block text-sm text-ink">{shortProvider(point.provider)}</span>
                    <span className="block font-mono text-2xs text-ink-2">
                      {modelName(point.provider) || "default model"}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-right text-sm font-semibold">
                    {point.quality.toFixed(3)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-sm text-ink-2">
                    {formatLatency(point.p50_latency_ms)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-sm text-ink-2">
                    {formatLatency(point.p95_latency_ms)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-sm text-ink-2">
                    {formatCost(point.cost_usd)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-sm text-ink-2">
                    {point.observations}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-sm text-ink-2">
                    {(point.degraded_rate * 100).toFixed(0)}%
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {point.pareto ? (
                      <span className="inline-flex items-center gap-1 text-ink">
                        <CircleCheck className="size-3.5 text-seal-ink" aria-hidden="true" />
                        Front
                      </span>
                    ) : (
                      <span className="text-ink-3">Dominated</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {routed ? (
                      <Badge tone="seal">Chosen</Badge>
                    ) : (
                      <span className="text-ink-3">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">How the router chooses</h3>
          <p className="max-w-[68ch] text-sm text-ink-2">
            {bench.methodology?.routing ??
              "Cheapest provider within 0.02 of the best quality per stage."}{" "}
            {bench.router_written
              ? "The choice is written to services/pipeline/router.json and used by the next analysis."
              : "No router file was written for this run."}
          </p>
          <dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            {Object.entries(bench.router).map(([stage, provider]) => (
              <div key={stage} className="contents">
                <dt className="text-ink-2">
                  {stage === "default" ? "Other stages" : (stageLabels[stage] ?? stage)}
                </dt>
                <dd className="font-mono text-xs leading-5 text-ink">{provider}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">Run details</h3>
          <ul className="flex flex-col gap-1 text-sm text-ink-2">
            <li>
              Fixed subset: {bench.subset.join(", ")}, {bench.repeats} repeats each.
            </li>
            {bench.methodology?.quality ? <li>{bench.methodology.quality}</li> : null}
            {bench.methodology?.pareto ? <li>{bench.methodology.pareto}</li> : null}
            {[...bench.skipped, ...bench.failures].map((item) => (
              <li key={item.provider}>
                <span className="font-mono text-xs text-ink">{item.provider}</span>{" "}
                {bench.skipped.includes(item) ? "skipped" : "excluded"}: {item.reason}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
