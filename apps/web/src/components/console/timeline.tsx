"use client";

import { scaleUtc } from "d3-scale";
import { CircleAlert } from "lucide-react";
import { useMemo } from "react";

import { EvidenceClassBadge } from "@/components/evidence/badges";
import { cn } from "@/lib/cn";
import { evidenceClassMeta } from "@/lib/evidence";
import { formatInterval, formatShortDay } from "@/lib/format";
import type { AnalysisResult, EvidenceClass, PseudonymEntry, TimelineEvent } from "@/lib/types";
import { useElementWidth } from "@/lib/use-width";

import { PseudoText, RefChip } from "./rich-text";

const DAY = 86_400_000;

function toTime(iso: string) {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function strongestClass(event: TimelineEvent, analysis: AnalysisResult): EvidenceClass | null {
  const classes = event.claim_ids
    .map((id) => analysis.claims.find((claim) => claim.claim_id === id)?.evidence_class)
    .filter((value): value is EvidenceClass => Boolean(value));
  if (classes.length === 0) return null;
  return classes.sort((a, b) => evidenceClassMeta[a].rank - evidenceClassMeta[b].rank)[0] ?? null;
}

const markTone: Record<string, string> = {
  documented: "var(--documented)",
  info: "var(--info)",
  allegation: "var(--allegation)",
  contradicted: "var(--contradicted)",
  unsupported: "var(--unsupported)",
};

function Track({
  event,
  scale,
  width,
  conflict,
  color,
}: {
  event: TimelineEvent;
  scale: (value: number) => number;
  width: number;
  conflict: boolean;
  color: string;
}) {
  const start = scale(toTime(event.interval.earliest));
  const end = scale(toTime(event.interval.latest) + DAY);
  const original = event.original_interval;
  const point = event.interval.earliest === event.interval.latest;
  const center = point ? scale(toTime(event.interval.earliest) + DAY / 2) : (start + end) / 2;
  return (
    <svg width={width} height={28} className="block overflow-visible" aria-hidden="true">
      <line x1={0} x2={width} y1={14} y2={14} stroke="var(--line)" strokeWidth={1} />
      {original ? (
        <rect
          x={scale(toTime(original.earliest))}
          y={7}
          width={Math.max(
            2,
            scale(toTime(original.latest) + DAY) - scale(toTime(original.earliest)),
          )}
          height={14}
          rx={7}
          fill="none"
          stroke={color}
          strokeOpacity={0.55}
          strokeDasharray="3 3"
        />
      ) : null}
      {point ? null : (
        <rect
          x={start}
          y={8}
          width={Math.max(4, end - start)}
          height={12}
          rx={6}
          fill={color}
          fillOpacity={0.22}
          stroke={color}
          strokeOpacity={0.7}
        />
      )}
      <circle
        cx={center}
        cy={14}
        r={point ? 5 : 3.5}
        fill={point ? color : "var(--bg)"}
        stroke={color}
        strokeWidth={point ? 0 : 2}
      />
      {conflict ? (
        <circle
          cx={center}
          cy={14}
          r={9}
          fill="none"
          stroke="var(--contradicted)"
          strokeWidth={1.5}
        />
      ) : null}
    </svg>
  );
}

export function Timeline({
  analysis,
  map,
  onClaim,
}: {
  analysis: AnalysisResult;
  map: PseudonymEntry[] | null;
  onClaim: (id: string) => void;
}) {
  const [trackRef, trackWidth] = useElementWidth<HTMLDivElement>(420);
  const events = useMemo(
    () => [...analysis.timeline].sort((a, b) => a.order_rank - b.order_rank),
    [analysis.timeline],
  );
  const conflictEvents = new Set(analysis.temporal_conflicts.flatMap((item) => item.event_ids));

  const scale = useMemo(() => {
    const times = events.flatMap((event) => [
      toTime(event.interval.earliest),
      toTime(event.interval.latest) + DAY,
      ...(event.original_interval
        ? [toTime(event.original_interval.earliest), toTime(event.original_interval.latest) + DAY]
        : []),
    ]);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const pad = Math.max(2 * DAY, (max - min) * 0.04);
    return scaleUtc()
      .domain([new Date(min - pad), new Date(max + pad)])
      .range([8, Math.max(80, trackWidth - 8)]);
  }, [events, trackWidth]);

  const ticks = scale.ticks(Math.max(2, Math.floor(trackWidth / 96)));
  const project = (value: number) => scale(new Date(value));

  if (events.length === 0) {
    return (
      <p className="text-base text-ink-2">
        No dated events could be placed on a timeline. Dates mentioned in the evidence appear here
        once the analysis finds them.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-2">
        <span className="inline-flex items-center gap-2">
          <svg width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="var(--documented)" />
          </svg>
          Known to the day
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="34" height="14" aria-hidden="true">
            <rect
              x="1"
              y="2"
              width="32"
              height="10"
              rx="5"
              fill="var(--info)"
              fillOpacity="0.22"
              stroke="var(--info)"
            />
          </svg>
          Uncertain date range
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="34" height="14" aria-hidden="true">
            <rect
              x="1"
              y="2"
              width="32"
              height="10"
              rx="5"
              fill="none"
              stroke="var(--ink-3)"
              strokeDasharray="3 3"
            />
          </svg>
          Range before constraint solving
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="18" height="18" aria-hidden="true">
            <circle
              cx="9"
              cy="9"
              r="7"
              fill="none"
              stroke="var(--contradicted)"
              strokeWidth="1.5"
            />
          </svg>
          In a temporal conflict
        </span>
      </div>

      <div role="table" aria-label="Timeline of events" className="flex flex-col">
        <div
          role="row"
          className="grid grid-cols-1 gap-2 border-b border-line pb-2 md:grid-cols-[minmax(0,1fr)_minmax(240px,45%)]"
        >
          <span role="columnheader" className="text-xs font-medium text-ink-3">
            Event
          </span>
          <div
            role="columnheader"
            ref={trackRef}
            className="relative hidden h-4 overflow-hidden md:block"
          >
            {ticks.map((tick) => (
              <span
                key={tick.toISOString()}
                className="tabular absolute -translate-x-1/2 text-2xs text-ink-3"
                style={{ left: scale(tick) }}
              >
                {formatShortDay(tick.toISOString())}
              </span>
            ))}
          </div>
        </div>
        {events.map((event) => {
          const evidenceClass = strongestClass(event, analysis);
          const tone = evidenceClass ? evidenceClassMeta[evidenceClass].tone : "unsupported";
          const color = markTone[tone] ?? "var(--ink-3)";
          const conflict = conflictEvents.has(event.event_id);
          return (
            <div
              role="row"
              key={event.event_id}
              className={cn(
                "grid grid-cols-1 items-center gap-2 border-b border-line py-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,45%)]",
              )}
            >
              <div role="cell" className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="tabular text-sm text-ink-2">
                    {formatInterval(event.interval.earliest, event.interval.latest)}
                  </span>
                  {event.interval.granularity !== "day" ? (
                    <span className="text-xs text-ink-3">± {event.interval.granularity}</span>
                  ) : null}
                  {conflict ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-contradicted">
                      <CircleAlert className="size-3.5" aria-hidden="true" />
                      Conflict
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-base font-medium text-ink">
                  <PseudoText text={event.title} map={map} />
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <EvidenceClassBadge value={evidenceClass} />
                  {event.claim_ids.map((id) => (
                    <RefChip key={id} id={id} onSelect={onClaim} />
                  ))}
                </div>
                {event.constraints.length > 0 ? (
                  <p className="mt-1 text-xs text-ink-3">
                    <PseudoText text={event.constraints.join("; ")} map={map} />
                  </p>
                ) : null}
              </div>
              <div role="cell" className="hidden overflow-hidden md:block">
                <Track
                  event={event}
                  scale={project}
                  width={trackWidth}
                  conflict={conflict}
                  color={color}
                />
              </div>
            </div>
          );
        })}
      </div>

      {analysis.temporal_conflicts.length > 0 ? (
        <section aria-labelledby="conflicts-heading">
          <h3 id="conflicts-heading" className="text-base font-semibold">
            Temporal conflicts
          </h3>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            Dates and orderings become constraints in a Simple Temporal Network. When the
            constraints cannot all hold, the solver finds the negative cycle and names the evidence
            behind it.
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {analysis.temporal_conflicts.map((conflict) => (
              <li key={conflict.conflict_id} className="rounded-lg bg-contradicted-soft/60 p-4">
                <p className="text-base leading-6 text-ink">
                  <PseudoText text={conflict.description} map={map} />
                </p>
                <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-ink-2">
                  {conflict.constraints.map((constraint) => (
                    <li key={constraint}>
                      <PseudoText text={constraint} map={map} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
