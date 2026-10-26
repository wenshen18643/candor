"use client";

import { CircleCheck, CircleX } from "lucide-react";
import { useMemo, useState } from "react";

import type { LogEntry } from "@/lib/audit-client";
import { cn } from "@/lib/cn";
import { truncateMiddle } from "@/lib/format";

import {
  type Directory,
  formatHour,
  relatedReport,
  requestIndex,
  shortId,
  summarize,
  typeMeta,
} from "./entry-meta";

type Scope = "all" | "focus";

export function EntriesTable({
  entries,
  leafHashes,
  directory,
  focusReportId,
  checked,
  selectedIndex,
  onSelect,
}: {
  entries: LogEntry[];
  leafHashes: Map<number, string>;
  directory: Directory;
  focusReportId: string | null;
  checked: Map<number, boolean>;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const [type, setType] = useState("all");
  const [scope, setScope] = useState<Scope>("all");
  const requests = useMemo(() => requestIndex(entries), [entries]);

  const scoped = useMemo(
    () =>
      scope === "focus" && focusReportId
        ? entries.filter((entry) => relatedReport(entry, requests) === focusReportId)
        : entries,
    [entries, scope, focusReportId, requests],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of scoped) map.set(entry.entry_type, (map.get(entry.entry_type) ?? 0) + 1);
    return map;
  }, [scoped]);

  const rows = useMemo(
    () =>
      scoped
        .filter((entry) => type === "all" || entry.entry_type === type)
        .sort((a, b) => b.index - a.index),
    [scoped, type],
  );

  const types = useMemo(
    () => [...new Set(entries.map((entry) => entry.entry_type))].sort(),
    [entries],
  );

  return (
    <section aria-labelledby="entries-heading" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="entries-heading" className="text-md font-semibold">
            Entries
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Event types and IDs only. Times are rounded to the hour. Select an entry to check its
            inclusion proof.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <span>Type</span>
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="h-8 rounded-md border border-line-strong bg-bg px-2 text-sm text-ink hover:border-ink-3 focus-visible:border-seal"
          >
            <option value="all">All types ({scoped.length})</option>
            {types.map((value) => (
              <option key={value} value={value}>
                {typeMeta(value).label} ({counts.get(value) ?? 0})
              </option>
            ))}
          </select>
        </label>
        {focusReportId ? (
          <div
            role="radiogroup"
            aria-label="Which reports"
            className="flex rounded-md bg-surface-2 p-0.5"
          >
            {(
              [
                ["all", "All reports"],
                ["focus", `Report ${shortId(focusReportId)}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                onClick={() => setScope(value)}
                className={cn(
                  "h-7 cursor-pointer rounded-sm px-2.5 text-sm transition-colors duration-150",
                  scope === value
                    ? "shadow-pop bg-bg font-medium text-ink"
                    : "text-ink-2 hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <span className="tabular text-sm text-ink-2" aria-live="polite">
          {rows.length} shown
        </span>
      </div>

      <div
        className="scrollbar-quiet relative max-h-[680px] overflow-auto rounded-lg border border-line"
        tabIndex={0}
        role="region"
        aria-label="Log entries, scrollable"
      >
        <table className="w-full border-collapse text-left sm:min-w-[520px]">
          <thead className="sticky top-0 z-10 bg-surface text-xs text-ink-2">
            <tr>
              <th scope="col" className="w-16 px-3 py-2 font-medium">
                #
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Event
              </th>
              <th
                scope="col"
                className="hidden w-32 px-3 py-2 font-medium whitespace-nowrap md:table-cell"
              >
                Hour (UTC)
              </th>
              <th scope="col" className="hidden w-36 px-3 py-2 font-medium sm:table-cell">
                Leaf hash
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              const meta = typeMeta(entry.entry_type);
              const Icon = meta.icon;
              const status = checked.get(entry.index);
              const focus = focusReportId && relatedReport(entry, requests) === focusReportId;
              return (
                <tr
                  key={entry.index}
                  onClick={() => onSelect(entry.index)}
                  className={cn(
                    "cursor-pointer border-t border-line align-top transition-colors duration-150 hover:bg-surface",
                    selectedIndex === entry.index && "bg-seal-soft hover:bg-seal-soft",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(entry.index);
                        }}
                        className="tabular cursor-pointer rounded-xs font-mono text-xs text-ink-2 hover:text-ink"
                        aria-label={`Open entry ${entry.index}, ${meta.label}`}
                      >
                        {entry.index}
                      </button>
                      {status === true ? (
                        <CircleCheck
                          className="size-3 text-documented"
                          role="img"
                          aria-label="Inclusion proof checked"
                        />
                      ) : status === false ? (
                        <CircleX
                          className="size-3 text-contradicted"
                          role="img"
                          aria-label="Inclusion proof failed"
                        />
                      ) : null}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Icon className="size-3.5 shrink-0 text-ink-2" aria-hidden="true" />
                      <span className="text-sm font-medium text-ink">{meta.label}</span>
                    </div>
                    <p className={cn("mt-0.5 text-sm", focus ? "text-ink" : "text-ink-2")}>
                      {summarize(entry, directory)}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-3 md:hidden">
                      {formatHour(entry.created_at)}
                    </p>
                  </td>
                  <td className="tabular hidden px-3 py-2.5 text-sm whitespace-nowrap text-ink-2 md:table-cell">
                    {formatHour(entry.created_at)}
                  </td>
                  <td className="hidden px-3 py-2.5 sm:table-cell">
                    <span
                      className="font-mono text-xs text-ink-2"
                      title={leafHashes.get(entry.index) ?? ""}
                    >
                      {leafHashes.has(entry.index)
                        ? truncateMiddle(leafHashes.get(entry.index)!, 6, 6)
                        : "…"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-2">No entries of this type.</p>
        ) : null}
      </div>
    </section>
  );
}
