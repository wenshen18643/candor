"use client";

import { scaleUtc } from "d3-scale";
import { CircleAlert } from "lucide-react";
import { useMemo } from "react";

import { EvidenceClassBadge } from "@/components/evidence/badges";
import { cn } from "@/lib/cn";
import { evidenceClassMeta } from "@/lib/evidence";
import { formatDay, formatInterval, formatShortDay } from "@/lib/format";
import type { AnalysisResult, EvidenceClass, PseudonymEntry, TimelineEvent } from "@/lib/types";
import { useElementWidth } from "@/lib/use-width";

import { PseudoText, RefChip } from "./rich-text";

const DAY = 86_400_000;

function toTime(iso: string) {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

const OPEN_START = toTime("1900-01-01");
const OPEN_END = toTime("2100-01-01");

type Interval = TimelineEvent["interval"];
type Span = { from: number | null; to: number | null };

function spanOf(interval: Interval): Span {
  const from = toTime(interval.earliest);
  const to = toTime(interval.latest);
  const vague = interval.granularity === "unknown" && to - from >= 300 * DAY;
  return {
    from: from < OPEN_START || vague ? null : from,
    to: to > OPEN_END ? null : to,
  };
}

const inverse: Record<string, string> = { before: "after", after: "before" };

function orderings(event: TimelineEvent) {
  const own = new Set(event.claim_ids);
  const seen = new Map<string, { relation: string; other: string }>();
  for (const name of event.constraints) {
    const match = /^(C\d+):(before|after|during|same_time):(C\d+):\d+$/.exec(name);
    if (!match) continue;
    const [, left = "", relation = "", right = ""] = match;
    const entry = own.has(left)
      ? { relation, other: right }
      : own.has(right)
        ? { relation: inverse[relation] ?? relation, other: left }
        : null;
    if (entry && !own.has(entry.other))
      seen.set(`${entry.relation}:${entry.other}`, {
        relation: entry.relation.replace("_", " "),
        other: entry.other,
      });
  }
  return [...seen.values()];
}

function spanLabel(interval: Interval) {
  const { from, to } = spanOf(interval);
  if (from === null && to === null) return "Date not stated";
  if (from === null) return `By ${formatDay(interval.latest)}`;
  if (to === null) return `From ${formatDay(interval.earliest)}`;
  return formatInterval(interval.earliest, interval.latest);
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
  const { from, to } = spanOf(event.interval);
  if (from === null || to === null) {
    const edge = from === null ? (to === null ? null : scale(to + DAY)) : scale(from);
    return (
      <svg width={width} height={28} className="block overflow-visible" aria-hidden="true">
        <line x1={0} x2={width} y1={14} y2={14} stroke="var(--line)" strokeWidth={1} />
        {edge === null ? null : (
          <>
            <line
              x1={from === null ? 0 : edge}
              x2={from === null ? edge : width}
              y1={14}
              y2={14}
              stroke={color}
              strokeOpacity={0.7}
              strokeWidth={2}
              strokeDasharray="2 4"
            />
            <circle cx={edge} cy={14} r={3.5} fill="var(--bg)" stroke={color} strokeWidth={2} />
          </>
        )}
      </svg>
    );
  }
  const start = scale(from);
  const end = scale(to + DAY);
  const prior = event.original_interval ? spanOf(event.original_interval) : null;
  const original =
    prior && prior.from !== null && prior.to !== null ? event.original_interval : null;
  const point = from === to;
  const center = point ? scale(from + DAY / 2) : (start + end) / 2;
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
  const events = useMemo(() => {
    const anchor = (event: TimelineEvent) => {
      const { from, to } = spanOf(event.interval);
      return from ?? to ?? Number.POSITIVE_INFINITY;
    };
    return [...analysis.timeline].sort(
      (a, b) => anchor(a) - anchor(b) || a.order_rank - b.order_rank,
    );
  }, [analysis.timeline]);
  const statements = useMemo(
    () => new Map(analysis.claims.map((claim) => [claim.claim_id, claim.statement])),
    [analysis.claims],
  );
  const conflictEvents = new Set(analysis.temporal_conflicts.flatMap((item) => item.event_ids));

  const scale = useMemo(() => {
    const times = events.flatMap((event) =>
      [event.interval, event.original_interval].flatMap((interval) => {
        if (!interval) return [];
        const { from, to } = spanOf(interval);
        return [from, to === null ? null : to + DAY].filter(
          (value): value is number => value !== null,
        );
      }),
    );
    const fallback = Date.parse("2026-01-01T00:00:00Z");
    const min = times.length > 0 ? Math.min(...times) : fallback;
    const max = times.length > 0 ? Math.max(...times) : fallback + 30 * DAY;
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
        No dates found yet. They appear here once the analysis finds them.
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
                  <span className="tabular text-sm text-ink-2">{spanLabel(event.interval)}</span>
                  {!["day", "unknown"].includes(event.interval.granularity) ? (
                    <span className="text-xs text-ink-3">± {event.interval.granularity}</span>
                  ) : null}
                  {conflict ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-contradicted">
                      <CircleAlert className="size-3.5" aria-hidden="true" />
                      Conflict
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 max-w-[68ch] text-base font-medium text-pretty text-ink">
                  <PseudoText
                    text={statements.get(event.claim_ids[0] ?? "") ?? event.title}
                    map={map}
                  />
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <EvidenceClassBadge value={evidenceClass} />
                  {event.claim_ids.map((id) => (
                    <RefChip key={id} id={id} onSelect={onClaim} />
                  ))}
                  {orderings(event).map(({ relation, other }) => (
                    <span
                      key={`${relation}-${other}`}
                      className="inline-flex items-center gap-1 text-xs text-ink-3"
                    >
                      {relation}
                      <RefChip id={other} onSelect={onClaim} />
                    </span>
                  ))}
                </div>
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
            These dates can&apos;t all be true at once.
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
