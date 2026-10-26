import { scaleLinear } from "d3-scale";

import { formatValue, type MetricDef, type ScenarioScore, statusOf } from "./model";

const width = 168;
const height = 30;
const padX = 6;

function domainFor(metric: MetricDef, values: number[]): [number, number] {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  if (metric.format === "rate") return [0, 1];
  if (metric.format === "tau") return [Math.min(min, 0), 1];
  if (metric.format === "days") return [0, Math.max(7, Math.ceil(max), metric.target.value * 2)];
  return [0, Math.max(3, Math.ceil(max))];
}

export function StripPlot({
  metric,
  scenarios,
}: {
  metric: MetricDef;
  scenarios: ScenarioScore[];
}) {
  const points = scenarios.map((scenario) => ({
    scenario,
    value: metric.perScenario(scenario),
  }));
  const measured = points.filter(
    (point): point is { scenario: ScenarioScore; value: number } => point.value !== null,
  );
  const x = scaleLinear()
    .domain(
      domainFor(
        metric,
        measured.map((point) => point.value),
      ),
    )
    .range([padX, width - padX])
    .clamp(true);
  const buckets = new Map<number, number>();
  const placed = measured.map((point) => {
    const px = x(point.value);
    const bucket = Math.round(px / 5);
    const k = buckets.get(bucket) ?? 0;
    buckets.set(bucket, k + 1);
    const offset = k === 0 ? 0 : (k % 2 === 1 ? -1 : 1) * Math.ceil(k / 2) * 4;
    return { ...point, px, py: height / 2 + offset, status: statusOf(point.value, metric.target) };
  });
  const tx = x(metric.target.value);
  const missing = points.length - measured.length;
  const misses = placed.filter((point) => point.status === "misses").length;
  const label = `${metric.label} per scenario: ${placed
    .map((point) => `${point.scenario.title} ${formatValue(point.value, metric.format)}`)
    .join(
      ", ",
    )}${missing ? `; ${missing} not measurable` : ""}. ${misses} of ${placed.length} miss the target.`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="block max-w-none"
    >
      <line
        x1={padX}
        x2={width - padX}
        y1={height / 2}
        y2={height / 2}
        stroke="var(--line-strong)"
        strokeWidth={1}
      />
      <line
        x1={tx}
        x2={tx}
        y1={4}
        y2={height - 4}
        stroke="var(--ink-3)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      {placed.map((point) => {
        const title = `${point.scenario.title}: ${formatValue(point.value, metric.format)}`;
        return point.status === "misses" ? (
          <rect
            key={point.scenario.scenario_id}
            x={point.px - 3.5}
            y={point.py - 3.5}
            width={7}
            height={7}
            transform={`rotate(45 ${point.px} ${point.py})`}
            fill="var(--contradicted)"
            stroke="var(--bg)"
            strokeWidth={1}
          >
            <title>{title}</title>
          </rect>
        ) : (
          <circle
            key={point.scenario.scenario_id}
            cx={point.px}
            cy={point.py}
            r={3.5}
            fill="var(--documented)"
            stroke="var(--bg)"
            strokeWidth={1}
          >
            <title>{title}</title>
          </circle>
        );
      })}
    </svg>
  );
}
