"use client";

import { GitCompareArrows } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hash } from "@/components/ui/hash";
import { consistencyShape, type SignedTreeHead } from "@/lib/audit-client";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

import { CheckStatus } from "./check-status";
import type { Check, Checkpoint } from "./checks";
import { chainLabel } from "./entry-meta";

export type ConsistencyResult = {
  first: Checkpoint;
  proof: string[];
  headSignature: boolean | null;
};

export function ConsistencyPanel({
  latest,
  checkpoints,
  selectedId,
  onSelect,
  check,
  result,
  onRun,
}: {
  latest: SignedTreeHead;
  checkpoints: Checkpoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  check: Check;
  result: ConsistencyResult | null;
  onRun: () => void;
}) {
  const selected = checkpoints.find((item) => item.id === selectedId) ?? null;
  return (
    <section aria-labelledby="consistency-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="consistency-heading" className="text-md font-semibold">
          Append-only check
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          Pick an earlier tree head. The server must prove that the earlier tree is an exact prefix
          of today&apos;s tree of {latest.tree_size}. If it passes, the log was only appended to,
          never rewritten.
        </p>
      </div>

      {checkpoints.length === 0 ? (
        <p className="rounded-lg bg-surface px-4 py-3 text-sm text-ink-2">
          No earlier tree head is known yet. This browser will remember today&apos;s signed head, so
          your next visit can check that nothing changed in between.
        </p>
      ) : (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs text-ink-2">Earlier tree head</legend>
          {checkpoints.map((item) => {
            const active = item.id === selectedId;
            return (
              <label
                key={item.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150",
                  active ? "border-seal bg-seal-soft" : "border-line hover:border-line-strong",
                )}
              >
                <input
                  type="radio"
                  name="checkpoint"
                  value={item.id}
                  checked={active}
                  onChange={() => onSelect(item.id)}
                  className="mt-1 accent-[var(--seal)]"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="tabular text-sm font-medium">{item.tree_size} entries</span>
                    <span className="text-xs text-ink-2">{formatDateTime(item.timestamp)}</span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {item.kinds.includes("signed") ? (
                      <Badge tone="outline">Signed head</Badge>
                    ) : null}
                    {item.kinds.includes("anchored") ? (
                      <Badge tone="outline">Anchored · {chainLabel(item.chain ?? "")}</Badge>
                    ) : null}
                    {item.kinds.includes("remembered") ? (
                      <Badge tone="outline">Seen by this browser</Badge>
                    ) : null}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={onRun}
          disabled={!selected}
          loading={check.status === "running"}
        >
          {check.status === "running" ? null : <GitCompareArrows aria-hidden="true" />}
          Check consistency
        </Button>
        <CheckStatus check={check} />
      </div>

      {selected ? (
        <PrefixBars
          first={selected.tree_size}
          second={latest.tree_size}
          ranges={consistencyShape(selected.tree_size, latest.tree_size)}
          state={check.status}
        />
      ) : null}

      <div aria-live="polite" className="flex flex-col gap-3">
        {check.status === "pass" || check.status === "fail" ? (
          <p className={cn("text-sm", check.status === "pass" ? "text-ink" : "text-contradicted")}>
            {check.detail}
          </p>
        ) : null}
        {result && (check.status === "pass" || check.status === "fail") ? (
          <ProofList result={result} second={latest.tree_size} />
        ) : null}
      </div>
    </section>
  );
}

function PrefixBars({
  first,
  second,
  ranges,
  state,
}: {
  first: number;
  second: number;
  ranges: { start: number; end: number }[];
  state: Check["status"];
}) {
  const pct = (value: number) => `${(value / second) * 100}%`;
  const prefixTone =
    state === "pass"
      ? "border-documented bg-documented-soft"
      : state === "fail"
        ? "border-contradicted bg-contradicted-soft"
        : "border-seal bg-seal-soft";
  return (
    <div
      role="img"
      aria-label={`The earlier tree of ${first} entries should be an unchanged prefix of the current tree of ${second}. The proof supplies ${ranges.length} subtree hashes.`}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-xs text-ink-2">Then</span>
        <div className="relative h-4 flex-1">
          <div
            className={cn("absolute inset-y-0 left-0 rounded-xs border", prefixTone)}
            style={{ width: pct(first) }}
          />
        </div>
        <span className="tabular w-8 shrink-0 text-right text-xs text-ink-2">{first}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-xs text-ink-2">Now</span>
        <div className="relative h-4 flex-1 rounded-xs bg-surface-2">
          <div
            className={cn("absolute inset-y-0 left-0 rounded-xs border", prefixTone)}
            style={{ width: pct(first) }}
          />
        </div>
        <span className="tabular w-8 shrink-0 text-right text-xs text-ink-2">{second}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-xs text-ink-2">Proof</span>
        <div className="relative h-3 flex-1">
          {ranges.map((range) => (
            <div
              key={`${range.start}-${range.end}`}
              className="absolute inset-y-0 rounded-xs border border-info bg-info-soft"
              style={{
                left: `calc(${pct(range.start)} + 1px)`,
                width: `calc(${pct(range.end - range.start)} - 2px)`,
              }}
            />
          ))}
        </div>
        <span className="w-8 shrink-0" />
      </div>
    </div>
  );
}

function ProofList({ result, second }: { result: ConsistencyResult; second: number }) {
  const ranges = consistencyShape(result.first.tree_size, second);
  return (
    <details className="group rounded-lg border border-line px-3 py-2 text-sm">
      <summary className="cursor-pointer text-ink-2 select-none hover:text-ink">
        {result.proof.length} proof hashes
        {result.headSignature === true ? " · earlier head signature valid" : ""}
        {result.headSignature === false ? " · earlier head signature invalid" : ""}
      </summary>
      <ol className="mt-2 flex flex-col gap-1.5">
        {result.proof.map((hash, i) => {
          const range = ranges[i];
          return (
            <li
              key={`${hash}-${i}`}
              className="flex flex-wrap items-center justify-between gap-x-3"
            >
              <span className="text-xs text-ink-2">
                {range
                  ? range.end - range.start === 1
                    ? `Entry ${range.start}`
                    : `Entries ${range.start}–${range.end - 1}`
                  : `Hash ${i + 1}`}
              </span>
              <Hash value={hash} head={10} tail={8} label="proof hash" />
            </li>
          );
        })}
      </ol>
    </details>
  );
}
