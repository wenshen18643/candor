import { useMemo } from "react";

import { type PathStep, treeLayout } from "@/lib/audit-client";

const width = 600;
const rowHeight = 16;
const rowGap = 5;

type Role = "leaf" | "computed" | "sibling" | "pending-path" | "pending-sibling" | "rest";

const fills: Record<Role, { fill: string; stroke: string; dash?: string }> = {
  leaf: { fill: "var(--seal)", stroke: "var(--seal)" },
  computed: { fill: "var(--seal)", stroke: "var(--seal)" },
  sibling: { fill: "var(--info-soft)", stroke: "var(--info)" },
  "pending-path": { fill: "var(--bg)", stroke: "var(--seal)", dash: "3 2" },
  "pending-sibling": { fill: "var(--surface-2)", stroke: "var(--line-strong)", dash: "3 2" },
  rest: { fill: "var(--surface-2)", stroke: "transparent" },
};

export function MerklePathDiagram({
  treeSize,
  index,
  steps,
  revealed,
  tampered,
}: {
  treeSize: number;
  index: number;
  steps: PathStep[];
  revealed: number;
  tampered: boolean;
}) {
  const layout = useMemo(() => treeLayout(treeSize), [treeSize]);
  const rows = layout.depth + 1;
  const scale = (value: number) => (value / treeSize) * width;

  const roles = useMemo(() => {
    const map = new Map<string, { role: Role; step: number }>();
    map.set(`${index}:${index + 1}`, { role: "leaf", step: 0 });
    steps.forEach((step, i) => {
      const done = revealed > i;
      map.set(`${step.node.start}:${step.node.end}`, {
        role: done ? "computed" : "pending-path",
        step: i + 1,
      });
      map.set(`${step.sibling.start}:${step.sibling.end}`, {
        role: done ? "sibling" : "pending-sibling",
        step: i + 1,
      });
    });
    return map;
  }, [index, steps, revealed]);

  const svgHeight = rows * rowHeight + (rows - 1) * rowGap;
  const markerPercent = ((index + 0.5) / treeSize) * 100;
  const computedColor = tampered ? "var(--contradicted)" : "var(--seal)";
  const label = `Merkle tree of ${treeSize} entries drawn as rows of subtrees, root at the top. Entry ${index} is at the bottom of a path of ${steps.length} combining steps. ${Math.min(revealed, steps.length)} of ${steps.length} steps have been computed.`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${svgHeight}`}
        role="img"
        aria-label={label}
        className="block w-full"
        style={{ height: svgHeight }}
        preserveAspectRatio="none"
      >
        {layout.nodes.map((node) => {
          const key = `${node.start}:${node.end}`;
          const entry = roles.get(key);
          const role: Role = entry?.role ?? "rest";
          const style = fills[role];
          const isComputed = role === "computed" || role === "leaf";
          const color = isComputed ? computedColor : null;
          const stroke = role === "pending-path" ? computedColor : style.stroke;
          const x = scale(node.start) + 0.75;
          const w = Math.max(scale(node.end) - scale(node.start) - 1.5, 1.5);
          const y = node.depth * (rowHeight + rowGap);
          const current =
            entry !== undefined &&
            entry.step > 0 &&
            entry.step === Math.min(revealed, steps.length);
          return (
            <rect
              key={key}
              x={x}
              y={y}
              width={w}
              height={rowHeight}
              fill={color ?? style.fill}
              stroke={color ?? stroke}
              strokeWidth={current ? 2.5 : 1}
              strokeDasharray={style.dash}
              vectorEffect="non-scaling-stroke"
              className="transition-[fill,stroke] duration-200"
            />
          );
        })}
      </svg>
      <div className="relative mt-1 h-7 text-2xs text-ink-3" aria-hidden="true">
        {markerPercent > 8 ? <span className="tabular absolute top-2.5 left-0">0</span> : null}
        {markerPercent < 92 ? (
          <span className="tabular absolute top-2.5 right-0">{treeSize - 1}</span>
        ) : null}
        <span
          className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `clamp(16px, ${markerPercent}%, calc(100% - 16px))` }}
        >
          <svg viewBox="0 0 10 7" className="h-[7px] w-2.5">
            <path d="M5 0 L10 7 H0 Z" fill={computedColor} />
          </svg>
          <span className="tabular font-mono text-2xs text-ink">#{index}</span>
        </span>
      </div>
    </div>
  );
}

export function MerkleLegend({ tampered }: { tampered: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      <li className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={
            tampered ? "size-2.5 rounded-xs bg-contradicted" : "size-2.5 rounded-xs bg-seal"
          }
        />
        Computed in your browser
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-xs border border-info bg-info-soft" />
        Sibling hash from the proof
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-xs bg-surface-2" />
        Rest of the log, never needed
      </li>
    </ul>
  );
}
