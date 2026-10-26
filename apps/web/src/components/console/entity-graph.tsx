"use client";

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { resolvePlaceholder } from "@/lib/pseudonyms";
import type { AnalysisResult, Entity, PseudonymEntry } from "@/lib/types";
import { useElementWidth } from "@/lib/use-width";

import { PseudoText, RefChip } from "./rich-text";

type Node = SimulationNodeDatum & { id: string; entity: Entity };
type Link = SimulationLinkDatum<Node> & { label: string; claimIds: string[]; key: string };

const HEIGHT = 440;

function layout(analysis: AnalysisResult, width: number) {
  const nodes: Node[] = analysis.entities.map((entity, index) => ({
    id: entity.entity_id,
    entity,
    x: width / 2 + Math.cos(index) * 120,
    y: HEIGHT / 2 + Math.sin(index) * 120,
  }));
  const ids = new Set(nodes.map((node) => node.id));
  const links: Link[] = analysis.relations
    .filter((relation) => ids.has(relation.source) && ids.has(relation.target))
    .map((relation, index) => ({
      source: relation.source,
      target: relation.target,
      label: relation.label,
      claimIds: relation.claim_ids,
      key: `${relation.source}-${relation.target}-${index}`,
    }));
  const simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink<Node, Link>(links)
        .id((node) => node.id)
        .distance(130)
        .strength(0.6),
    )
    .force("charge", forceManyBody().strength(-520))
    .force("center", forceCenter(width / 2, HEIGHT / 2))
    .force("collide", forceCollide(46))
    .stop();
  for (let tick = 0; tick < 320; tick += 1) simulation.tick();
  for (const node of nodes) {
    node.x = Math.max(56, Math.min(width - 56, node.x ?? 0));
    node.y = Math.max(36, Math.min(HEIGHT - 36, node.y ?? 0));
  }
  return { nodes, links };
}

function nodeLabel(entity: Entity, map: PseudonymEntry[] | null) {
  return resolvePlaceholder(entity.placeholder, map) ?? entity.placeholder;
}

export function EntityGraph({
  analysis,
  map,
  onClaim,
}: {
  analysis: AnalysisResult;
  map: PseudonymEntry[] | null;
  onClaim: (id: string) => void;
}) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>(640);
  const [selected, setSelected] = useState<string | null>(analysis.entities[0]?.entity_id ?? null);
  const graph = useMemo(() => layout(analysis, Math.max(320, width)), [analysis, width]);
  const selectedEntity = analysis.entities.find((entity) => entity.entity_id === selected) ?? null;
  const connected = new Set(
    graph.links
      .filter((link) => {
        const source = (link.source as Node).id;
        const target = (link.target as Node).id;
        return source === selected || target === selected;
      })
      .flatMap((link) => [(link.source as Node).id, (link.target as Node).id]),
  );
  const relatedClaims = analysis.claims.filter(
    (claim) =>
      selectedEntity &&
      (claim.actors.includes(selectedEntity.placeholder) ||
        claim.targets.includes(selectedEntity.placeholder)),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div ref={containerRef} className="min-w-0 rounded-lg border border-line bg-surface">
        <svg
          width={Math.max(320, width)}
          height={HEIGHT}
          role="img"
          aria-label={`Graph of ${analysis.entities.length} people and organisations and ${graph.links.length} relationships. The list beside it contains the same information.`}
          className="block"
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink-3)" />
            </marker>
          </defs>
          {graph.links.map((link) => {
            const source = link.source as Node;
            const target = link.target as Node;
            const active = source.id === selected || target.id === selected;
            const dx = (target.x ?? 0) - (source.x ?? 0);
            const dy = (target.y ?? 0) - (source.y ?? 0);
            const length = Math.max(1, Math.hypot(dx, dy));
            const inset = 30;
            const x1 = (source.x ?? 0) + (dx / length) * inset;
            const y1 = (source.y ?? 0) + (dy / length) * inset;
            const x2 = (target.x ?? 0) - (dx / length) * inset;
            const y2 = (target.y ?? 0) - (dy / length) * inset;
            return (
              <g key={link.key} opacity={selected && !active ? 0.25 : 1}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={active ? "var(--seal)" : "var(--line-strong)"}
                  strokeWidth={active ? 1.75 : 1.25}
                  markerEnd="url(#arrow)"
                  strokeDasharray={link.label.startsWith("allegedly") ? "4 4" : undefined}
                />
                {active ? (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 6}
                    textAnchor="middle"
                    className="fill-ink-2 text-[11px]"
                    paintOrder="stroke"
                    stroke="var(--surface)"
                    strokeWidth={4}
                  >
                    {link.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {graph.nodes.map((node) => {
            const isSelected = node.id === selected;
            const dim = selected && !isSelected && !connected.has(node.id);
            const label = nodeLabel(node.entity, map);
            const person = node.entity.type === "person";
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                opacity={dim ? 0.35 : 1}
                className="cursor-pointer"
                onClick={() => setSelected(node.id)}
                role="button"
                tabIndex={0}
                aria-label={`${label}, ${node.entity.type}`}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelected(node.id);
                }}
              >
                {person ? (
                  <circle
                    r={isSelected ? 22 : 18}
                    fill={isSelected ? "var(--seal)" : "var(--bg)"}
                    stroke={isSelected ? "var(--seal)" : "var(--line-strong)"}
                    strokeWidth={1.5}
                  />
                ) : (
                  <rect
                    x={isSelected ? -22 : -18}
                    y={isSelected ? -22 : -18}
                    width={isSelected ? 44 : 36}
                    height={isSelected ? 44 : 36}
                    rx={7}
                    fill={isSelected ? "var(--seal)" : "var(--surface-2)"}
                    stroke={isSelected ? "var(--seal)" : "var(--line-strong)"}
                    strokeWidth={1.5}
                  />
                )}
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  className={cn(
                    "text-[10px] font-medium",
                    isSelected ? "fill-on-seal" : "fill-ink-2",
                  )}
                >
                  {node.entity.mention_count}
                </text>
                <text
                  y={isSelected ? 38 : 33}
                  textAnchor="middle"
                  className={cn("text-[12px]", isSelected ? "fill-ink font-semibold" : "fill-ink")}
                  paintOrder="stroke"
                  stroke="var(--surface)"
                  strokeWidth={4}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <aside className="flex flex-col gap-4">
        {selectedEntity ? (
          <section aria-live="polite">
            <div className="flex items-center gap-2">
              <h3 className="text-md font-semibold">{nodeLabel(selectedEntity, map)}</h3>
              <Badge tone="outline">{selectedEntity.type}</Badge>
            </div>
            {map ? (
              <p className="mt-0.5 font-mono text-xs text-ink-3">{selectedEntity.placeholder}</p>
            ) : null}
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div>
                <dt className="text-ink-3">Roles in the evidence</dt>
                <dd className="text-ink">
                  <PseudoText text={selectedEntity.roles.join(", ") || "None stated"} map={map} />
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Also referred to as</dt>
                <dd className="text-ink">
                  <PseudoText text={selectedEntity.aliases.join(", ") || "No aliases"} map={map} />
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Mentions</dt>
                <dd className="tabular text-ink">{selectedEntity.mention_count}</dd>
              </div>
            </dl>
            <h4 className="mt-4 text-sm font-semibold">Claims involving them</h4>
            <ul className="mt-2 flex flex-col gap-2">
              {relatedClaims.map((claim) => (
                <li key={claim.claim_id} className="text-sm leading-5 text-ink-2">
                  <RefChip id={claim.claim_id} onSelect={onClaim} />{" "}
                  <PseudoText text={claim.statement} map={map} />
                </li>
              ))}
              {relatedClaims.length === 0 ? (
                <li className="text-sm text-ink-3">No claims name them directly.</li>
              ) : null}
            </ul>
          </section>
        ) : null}
        <section>
          <h3 className="text-sm font-semibold">Everyone in the evidence</h3>
          <ul className="mt-2 flex flex-col">
            {analysis.entities.map((entity) => (
              <li key={entity.entity_id}>
                <button
                  type="button"
                  onClick={() => setSelected(entity.entity_id)}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2",
                    entity.entity_id === selected && "bg-surface-2 font-medium",
                  )}
                >
                  <span>{nodeLabel(entity, map)}</span>
                  <span className="text-xs text-ink-3">
                    {entity.roles[0] ? (
                      <PseudoText text={entity.roles[0]} map={map} />
                    ) : (
                      entity.type
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
