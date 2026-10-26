"use client";

import { Braces, MessageSquareText } from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { useId, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { stageDependencies, stageMeta, stageOrder } from "@/lib/evidence";
import type { StageName } from "@/lib/types";

const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];

const viewWidth = 360;
const rowGap = 50;
const margin = 12;
const nodeHeight = 34;
const laneX = [64, 180, 296];
const detourX = 90;
const sideLane: Partial<Record<StageName, number>> = { entities: 0, temporal: 2 };

const ports: Record<string, [number, number]> = {
  "segment>injection_scan": [10, 10],
  "segment>extract": [-30, -16],
  "injection_scan>extract": [10, 10],
  "consolidate>entities": [-24, 0],
  "consolidate>temporal": [24, 0],
  "verify>contradictions": [10, 0],
  "verify>calibrate": [-30, -26],
  "temporal>contradictions": [-18, 26],
  "temporal>calibrate": [0, 26],
  "temporal>gaps": [18, 26],
  "entities>gaps": [0, -26],
};

const stages = stageOrder as readonly StageName[];

const depth = (() => {
  const memo = new Map<StageName, number>();
  const visit = (stage: StageName): number => {
    const known = memo.get(stage);
    if (known !== undefined) return known;
    const deps = (stageDependencies[stage] ?? []) as StageName[];
    const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(visit));
    memo.set(stage, value);
    return value;
  };
  stages.forEach(visit);
  return memo;
})();

const maxDepth = Math.max(...depth.values());
const viewHeight = margin * 2 + nodeHeight + maxDepth * rowGap;

type NodeBox = { stage: StageName; x: number; y: number; width: number; depth: number };

const nodes: NodeBox[] = stages.map((stage) => {
  const level = depth.get(stage) ?? 0;
  const lane = sideLane[stage] ?? 1;
  const crowded = lane === 1 && level === depth.get("temporal");
  return {
    stage,
    x: laneX[lane] ?? 180,
    y: margin + nodeHeight / 2 + level * rowGap,
    width: lane === 1 && !crowded ? 150 : 100,
    depth: level,
  };
});

const nodeByStage = new Map(nodes.map((node) => [node.stage, node]));

type Edge = { from: StageName; to: StageName; d: string; depth: number };

const edges: Edge[] = stages.flatMap((to) =>
  ((stageDependencies[to] ?? []) as StageName[]).flatMap((from) => {
    const source = nodeByStage.get(from);
    const target = nodeByStage.get(to);
    if (!source || !target) return [];
    const [outOffset, inOffset] = ports[`${from}>${to}`] ?? [0, 0];
    const sx = source.x + outOffset;
    const sy = source.y + nodeHeight / 2;
    const tx = target.x + inOffset;
    const ty = target.y - nodeHeight / 2;
    let d: string;
    if (target.depth - source.depth === 1) {
      const mid = (sy + ty) / 2;
      d = sx === tx ? `M${sx} ${sy}V${ty}` : `M${sx} ${sy}C${sx} ${mid} ${tx} ${mid} ${tx} ${ty}`;
    } else {
      const runX = sideLane[from] === undefined ? detourX : sx;
      d = `M${sx} ${sy}`;
      if (runX !== sx) d += `C${sx} ${sy + 10} ${runX} ${sy + 6} ${runX} ${sy + 16}`;
      d += `V${ty - 20}C${runX} ${ty - 8} ${tx} ${ty - 14} ${tx} ${ty}`;
    }
    return [{ from, to, d, depth: source.depth }];
  }),
);

const pct = (value: number, total: number) => `${(value / total) * 100}%`;

export function PipelineGraph({
  selected,
  onSelect,
  className,
}: {
  selected: StageName;
  onSelect: (stage: StageName) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const reduce = useReducedMotion() ?? false;
  const [hovered, setHovered] = useState<StageName | null>(null);
  const focus = hovered ?? selected;
  const markerBase = useId().replace(/[^a-zA-Z0-9]/g, "");
  const shown = inView || reduce;

  return (
    <div className={cn("mx-auto w-full max-w-[24rem]", className)}>
      <div
        ref={ref}
        role="group"
        aria-label="Analysis pipeline: twelve stages as a dependency graph. Choose a stage to read how it works."
        className="relative w-full"
        style={{ aspectRatio: `${viewWidth} / ${viewHeight}` }}
      >
        <svg
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
          fill="none"
        >
          <defs>
            <marker
              id={`${markerBase}-arrow`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0 0L8 4L0 8z" className="fill-ink-3" />
            </marker>
            <marker
              id={`${markerBase}-arrow-active`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0 0L8 4L0 8z" className="fill-seal" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const active = edge.from === focus || edge.to === focus;
            return (
              <motion.path
                key={`${edge.from}-${edge.to}`}
                d={edge.d}
                className={cn(
                  "transition-[stroke] duration-200",
                  active ? "stroke-seal" : "stroke-ink-3",
                )}
                strokeWidth={active ? 1.75 : 1.25}
                strokeLinecap="round"
                markerEnd={`url(#${markerBase}-arrow${active ? "-active" : ""})`}
                initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                animate={shown ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
                transition={{ duration: 0.7, ease: easeOutExpo, delay: 0.1 + edge.depth * 0.07 }}
              />
            );
          })}
        </svg>
        {nodes.map((node) => {
          const meta = stageMeta[node.stage];
          const model = meta?.kind === "llm";
          const Icon = model ? MessageSquareText : Braces;
          const isSelected = node.stage === selected;
          const deps = (stageDependencies[node.stage] ?? []).map(
            (dep) => stageMeta[dep]?.label ?? dep,
          );
          return (
            <motion.button
              key={node.stage}
              type="button"
              onClick={() => onSelect(node.stage)}
              onMouseEnter={() => setHovered(node.stage)}
              onMouseLeave={() => setHovered(null)}
              aria-pressed={isSelected}
              aria-label={`${meta?.label ?? node.stage}, ${model ? "model call" : "deterministic code"}${deps.length ? `, after ${deps.join(" and ")}` : ", first stage"}`}
              className={cn(
                "absolute flex cursor-pointer items-center justify-center gap-1.5 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow] duration-150 sm:text-[0.8125rem]",
                model
                  ? "border-seal/35 bg-seal-soft text-seal-ink hover:border-seal"
                  : "border-ink-3/45 bg-bg text-ink hover:border-ink-3",
                isSelected && "border-seal shadow-[0_0_0_1px_var(--seal)]",
              )}
              style={{
                left: pct(node.x - node.width / 2, viewWidth),
                top: pct(node.y - nodeHeight / 2, viewHeight),
                width: pct(node.width, viewWidth),
                height: pct(nodeHeight, viewHeight),
              }}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
              transition={{ duration: 0.5, ease: easeOutExpo, delay: node.depth * 0.07 }}
            >
              <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden="true" />
              <span className="truncate">{meta?.label ?? node.stage}</span>
              {node.stage === "extract" ? (
                <span className="font-mono text-2xs opacity-80">×3</span>
              ) : null}
            </motion.button>
          );
        })}
      </div>
      <ol className="sr-only">
        {stages.map((stage) => (
          <li key={stage}>
            {stageMeta[stage]?.label}: {stageMeta[stage]?.kind === "llm" ? "model call" : "code"};
            depends on{" "}
            {(stageDependencies[stage] ?? []).map((dep) => stageMeta[dep]?.label).join(", ") ||
              "nothing"}
            .
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PipelineLegend({ className }: { className?: string }) {
  const modelCount = stages.filter((stage) => stageMeta[stage]?.kind === "llm").length;
  return (
    <ul className={cn("flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2", className)}>
      <li className="inline-flex items-center gap-2">
        <span className="inline-flex size-6 items-center justify-center rounded-sm border border-ink-3/45 bg-bg text-ink">
          <Braces className="size-3.5" aria-hidden="true" />
        </span>
        Deterministic code ({stages.length - modelCount})
      </li>
      <li className="inline-flex items-center gap-2">
        <span className="inline-flex size-6 items-center justify-center rounded-sm border border-seal/35 bg-seal-soft text-seal-ink">
          <MessageSquareText className="size-3.5" aria-hidden="true" />
        </span>
        Model call ({modelCount})
      </li>
    </ul>
  );
}
