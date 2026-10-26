import { cn } from "@/lib/cn";

export type Lifeline = { id: string; label: string; sub: string };

export type SequenceStep =
  | {
      kind: "message";
      from: string;
      to: string;
      label: string;
      detail?: string;
      reply?: boolean;
      emphasis?: boolean;
    }
  | { kind: "note"; at: string; lines: string[] };

const width = 760;
const gutter = 16;
const headerHeight = 52;
const messageHeight = 46;
const lineHeight = 16;

type Placed =
  | { step: Extract<SequenceStep, { kind: "message" }>; y: number; index: number }
  | { step: Extract<SequenceStep, { kind: "note" }>; y: number; height: number };

function layout(lifelines: Lifeline[], steps: SequenceStep[]) {
  const column = (width - gutter * 2) / lifelines.length;
  const xOf = (id: string) => {
    const index = lifelines.findIndex((line) => line.id === id);
    return gutter + column * (index + 0.5);
  };
  let y = headerHeight + 22;
  let counter = 0;
  const placed: Placed[] = steps.map((step) => {
    if (step.kind === "message") {
      counter += 1;
      const entry: Placed = { step, y, index: counter };
      y += messageHeight;
      return entry;
    }
    const height = step.lines.length * lineHeight + 14;
    const entry: Placed = { step, y: y - 6, height };
    y += height + 22;
    return entry;
  });
  return { column, xOf, placed, height: y + 8 };
}

export function SequenceDiagram({
  id,
  title,
  lifelines,
  steps,
}: {
  id: string;
  title: string;
  lifelines: Lifeline[];
  steps: SequenceStep[];
}) {
  const { column, xOf, placed, height } = layout(lifelines, steps);
  const noteWidth = Math.min(column * 1.8, 340);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label={title}
      fill="none"
    >
      <defs>
        <marker
          id={`${id}-arrow`}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L8 4L0 8z" className="fill-ink-2" />
        </marker>
        <marker
          id={`${id}-arrow-seal`}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L8 4L0 8z" className="fill-seal" />
        </marker>
      </defs>

      {lifelines.map((line) => {
        const x = xOf(line.id);
        return (
          <g key={line.id}>
            <line
              x1={x}
              x2={x}
              y1={headerHeight}
              y2={height - 4}
              className="stroke-ink-3/60"
              strokeDasharray="3 4"
            />
            <rect
              x={x - column / 2 + 6}
              y={0}
              width={column - 12}
              height={headerHeight - 6}
              rx={7}
              className="fill-bg stroke-ink-3/40"
            />
            <text x={x} y={20} textAnchor="middle" className="fill-ink text-[13.5px] font-semibold">
              {line.label}
            </text>
            <text x={x} y={36} textAnchor="middle" className="fill-ink-3 font-mono text-[10.5px]">
              {line.sub}
            </text>
          </g>
        );
      })}

      {placed.map((entry, position) => {
        if (entry.step.kind === "note") {
          const center = xOf(entry.step.at);
          const left = Math.max(6, Math.min(width - 6 - noteWidth, center - noteWidth / 2));
          return (
            <g key={position}>
              <rect
                x={left}
                y={entry.y}
                width={noteWidth}
                height={"height" in entry ? entry.height : 0}
                rx={6}
                className="fill-surface-3"
              />
              {entry.step.lines.map((text, lineIndex) => (
                <text
                  key={lineIndex}
                  x={left + 12}
                  y={entry.y + 19 + lineIndex * lineHeight}
                  className="fill-ink-2 text-[12px]"
                >
                  {text}
                </text>
              ))}
            </g>
          );
        }
        const step = entry.step;
        const x1 = xOf(step.from);
        const x2 = xOf(step.to);
        const direction = x2 > x1 ? 1 : -1;
        const mid = (x1 + x2) / 2;
        const arrowY = entry.y + 9;
        const number = "index" in entry ? entry.index : 0;
        return (
          <g key={position}>
            <text x={mid} y={entry.y} textAnchor="middle" className="fill-ink text-[12.5px]">
              <tspan className="fill-ink-3 font-mono text-[10.5px]">{number} </tspan>
              {step.label}
            </text>
            <line
              x1={x1 + direction * 3}
              x2={x2 - direction * 5}
              y1={arrowY}
              y2={arrowY}
              strokeWidth={step.emphasis ? 1.75 : 1.25}
              strokeDasharray={step.reply ? "5 4" : undefined}
              className={cn(step.emphasis ? "stroke-seal" : "stroke-ink-2")}
              markerEnd={`url(#${id}-arrow${step.emphasis ? "-seal" : ""})`}
            />
            {step.detail ? (
              <text
                x={mid}
                y={arrowY + 15}
                textAnchor="middle"
                className="fill-ink-3 font-mono text-[10.5px]"
              >
                {step.detail}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function SequenceText({
  lifelines,
  steps,
}: {
  lifelines: Lifeline[];
  steps: SequenceStep[];
}) {
  const name = (id: string) => lifelines.find((line) => line.id === id)?.label ?? id;
  let counter = 0;
  return (
    <ol className="flex flex-col gap-2.5 text-sm">
      {steps.map((step, index) => {
        if (step.kind === "note")
          return (
            <li key={index} className="rounded-md bg-surface-2 px-3 py-2 text-ink-2">
              <span className="font-medium text-ink">{name(step.at)}: </span>
              {step.lines.join(". ")}.
            </li>
          );
        counter += 1;
        return (
          <li key={index} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-1.5">
            <span className="tabular font-mono text-xs text-ink-3">{counter}</span>
            <span className="text-ink-2">
              <span className="font-medium text-ink">
                {name(step.from)} → {name(step.to)}:
              </span>{" "}
              {step.label}
              {step.detail ? (
                <span className="font-mono text-xs break-words text-ink-3"> ({step.detail})</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
