"use client";

import { CircleCheck, CircleX, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Hash } from "@/components/ui/hash";
import { Sheet } from "@/components/ui/sheet";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  type AuditClient,
  auditPathShape,
  hourBucket,
  loadCrypto,
  type LogEntry,
  type PathStep,
  type SignedTreeHead,
} from "@/lib/audit-client";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

import { type Directory, reviewerName, typeMeta } from "./entry-meta";
import { MerkleLegend, MerklePathDiagram } from "./merkle-path-diagram";

type Walk =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "done";
      leafHash: string;
      serverLeafHash: string;
      originalLeafHash: string;
      siblings: string[];
      values: string[];
      shape: PathStep[];
      computedRoot: string;
      ok: boolean;
    };

const idPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64}/;

function tamperPosition(text: string) {
  const match = idPattern.exec(text);
  if (match) return match.index + match[0].length - 1;
  return Math.max(0, text.length - 3);
}

function bumpByte(value: number) {
  if (value >= 0x30 && value <= 0x38) return value + 1;
  if (value === 0x39) return 0x30;
  if (value >= 0x61 && value <= 0x65) return value + 1;
  if (value === 0x66) return 0x65;
  return value ^ 0x01;
}

const range = (r: { start: number; end: number }) =>
  r.end - r.start === 1 ? `entry ${r.start}` : `entries ${r.start}–${r.end - 1}`;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function EntrySheet({
  entry,
  latest,
  client,
  directory,
  signatureVerified,
  onOpenChange,
  onChecked,
}: {
  entry: LogEntry | null;
  latest: SignedTreeHead;
  client: AuditClient;
  directory: Directory;
  signatureVerified: boolean | null;
  onOpenChange: (open: boolean) => void;
  onChecked: (index: number, ok: boolean, tampered: boolean) => void;
}) {
  const [tampered, setTampered] = useState(false);
  const [walk, setWalk] = useState<Walk>({ status: "loading" });
  const [revealed, setRevealed] = useState(0);
  const timer = useRef<number | null>(null);

  const leafText = useMemo(() => {
    if (!entry) return "";
    try {
      const binary = atob(entry.leaf_b64u.replace(/-/g, "+").replace(/_/g, "/"));
      return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    } catch {
      return "";
    }
  }, [entry]);
  const position = useMemo(() => tamperPosition(leafText), [leafText]);

  const stopTimer = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  };

  const animate = useCallback((total: number) => {
    stopTimer();
    if (prefersReducedMotion()) {
      setRevealed(total);
      return;
    }
    setRevealed(0);
    timer.current = window.setInterval(() => {
      setRevealed((value) => {
        if (value >= total) {
          stopTimer();
          return value;
        }
        return value + 1;
      });
    }, 420);
  }, []);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setWalk({ status: "loading" });
    stopTimer();
    setRevealed(0);
    (async () => {
      try {
        if (entry.index >= latest.tree_size)
          throw new Error("This entry is newer than the latest signed tree head. Reload the log.");
        const [c, proof] = await Promise.all([
          loadCrypto(),
          client.getInclusionProof(entry.index, latest.tree_size),
        ]);
        const original = c.b64u.decode(entry.leaf_b64u);
        const bytes = original.slice();
        if (tampered && bytes.length > position) bytes[position] = bumpByte(bytes[position]!);
        const shape = auditPathShape(entry.index, latest.tree_size);
        const siblings = proof.audit_path.map((value) => c.fromHex(value));
        let current = c.leafHash(bytes);
        const values = [c.toHex(current)];
        shape.forEach((step, i) => {
          const sibling = siblings[i];
          if (!sibling) return;
          current =
            step.side === "left" ? c.nodeHash(sibling, current) : c.nodeHash(current, sibling);
          values.push(c.toHex(current));
        });
        const ok = c.verifyInclusion(
          bytes,
          entry.index,
          latest.tree_size,
          siblings,
          c.fromHex(latest.root_hash),
        );
        if (cancelled) return;
        setWalk({
          status: "done",
          leafHash: values[0]!,
          serverLeafHash: proof.leaf_hash,
          originalLeafHash: c.toHex(c.leafHash(original)),
          siblings: proof.audit_path,
          values,
          shape,
          computedRoot: values[values.length - 1]!,
          ok,
        });
        onChecked(entry.index, ok, tampered);
        animate(shape.length + 1);
      } catch (error) {
        if (!cancelled)
          setWalk({
            status: "error",
            message: error instanceof Error ? error.message : "The proof could not be checked.",
          });
      }
    })();
    return () => {
      cancelled = true;
      stopTimer();
    };
  }, [entry, latest, client, tampered, position, animate, onChecked]);

  if (!entry) return null;

  const meta = typeMeta(entry.entry_type);
  const Icon = meta.icon;
  const done = walk.status === "done";
  const finished = done && revealed > walk.shape.length;
  const fields = Object.entries(entry.entry).filter(([key]) => key !== "type");

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      width="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <Icon className="size-4 text-ink-2" aria-hidden="true" />
          Entry #{entry.index} · {meta.label}
        </span>
      }
      description={`Logged in the hour starting ${formatDateTime(hourBucket(entry.created_at))}`}
    >
      <div className="flex flex-col gap-8">
        <section aria-labelledby="entry-fields" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="entry-fields" className="text-base font-semibold">
              What was logged
            </h3>
            <span className="font-mono text-2xs text-ink-3">{entry.entry_type}</span>
          </div>
          <p className="max-w-[68ch] text-sm text-ink-2">{meta.meaning}</p>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg bg-surface px-4 py-3 text-sm">
            {fields.map(([key, value]) => {
              const person =
                typeof value === "string" && directory.has(value)
                  ? reviewerName(directory, value)
                  : null;
              return (
                <div key={key} className="contents">
                  <dt className="font-mono text-xs leading-5 text-ink-3">{key}</dt>
                  <dd className="min-w-0 font-mono text-xs leading-5 break-all text-ink">
                    {String(value)}
                    {person ? <span className="ml-2 font-sans text-ink-2">({person})</span> : null}
                  </dd>
                </div>
              );
            })}
          </dl>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-xs text-ink-2">
              <span>Exact leaf bytes, canonical JSON</span>
              <span className="tabular">{new TextEncoder().encode(leafText).length} bytes</span>
            </div>
            <p className="rounded-lg border border-line px-3 py-2 font-mono text-xs leading-5 break-all text-ink-2">
              {leafText.slice(0, position)}
              <mark
                className={cn(
                  "rounded-[2px] px-px",
                  tampered
                    ? "bg-contradicted-soft text-contradicted underline decoration-2 underline-offset-2"
                    : "bg-transparent text-ink-2",
                )}
              >
                {tampered
                  ? String.fromCharCode(bumpByte(leafText.charCodeAt(position)))
                  : leafText.charAt(position)}
              </mark>
              {leafText.slice(position + 1)}
            </p>
          </div>
          <div className="rounded-lg border border-line px-4 py-3">
            <ToggleSwitch
              id="tamper-entry"
              tone="contradicted"
              checked={tampered}
              onCheckedChange={setTampered}
              label="Tamper with this entry"
              description={
                tampered
                  ? `Byte ${position} changed from “${leafText.charAt(position)}” to “${String.fromCharCode(bumpByte(leafText.charCodeAt(position)))}”. Watch the check below fail.`
                  : "Change one byte of the logged entry and run the same proof. A real edit to the log would look like this."
              }
            />
          </div>
        </section>

        <section aria-labelledby="inclusion-heading" className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="inclusion-heading" className="text-base font-semibold">
                Inclusion proof
              </h3>
              <p className="max-w-[60ch] text-sm text-ink-2">
                The server sent {done ? walk.siblings.length : "a few"} sibling hashes. Your browser
                hashes this entry, combines it with each sibling up the tree, and compares the
                result with the root signed for {latest.tree_size} entries.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => done && animate(walk.shape.length + 1)}
              disabled={!done}
            >
              <RotateCcw aria-hidden="true" />
              Replay
            </Button>
          </div>

          {walk.status === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-ink-2" role="status">
              <Spinner /> Fetching the proof and hashing…
            </div>
          ) : null}
          {walk.status === "error" ? (
            <p
              className="rounded-lg bg-contradicted-soft px-4 py-3 text-sm text-contradicted"
              role="alert"
            >
              {walk.message}
            </p>
          ) : null}

          {done ? (
            <>
              <div className="flex flex-col gap-2">
                <MerklePathDiagram
                  treeSize={latest.tree_size}
                  index={entry.index}
                  steps={walk.shape}
                  revealed={revealed}
                  tampered={tampered}
                />
                <MerkleLegend tampered={tampered} />
              </div>

              <ol className="flex flex-col" aria-label="Audit path steps">
                <StepRow
                  state="done"
                  tampered={tampered}
                  title="Hash the entry"
                  formula="SHA-256(0x00 ‖ entry bytes)"
                  detail={`covers ${range({ start: entry.index, end: entry.index + 1 })}`}
                  value={walk.values[0]!}
                  first
                  last={walk.shape.length === 0}
                />
                {walk.shape.map((step, i) => (
                  <StepRow
                    key={i}
                    state={revealed > i ? "done" : revealed === i ? "current" : "pending"}
                    tampered={tampered}
                    title={`Combine with the sibling on the ${step.side}`}
                    formula={
                      step.side === "left"
                        ? "SHA-256(0x01 ‖ sibling ‖ ours)"
                        : "SHA-256(0x01 ‖ ours ‖ sibling)"
                    }
                    detail={`sibling covers ${range(step.sibling)}; result covers ${range(step.node)}`}
                    sibling={walk.siblings[i]}
                    value={walk.values[i + 1] ?? ""}
                    last={i === walk.shape.length - 1}
                  />
                ))}
              </ol>

              <div
                aria-live="polite"
                className={cn(
                  "flex flex-col gap-3 rounded-lg px-4 py-4 transition-opacity duration-200",
                  !finished && "opacity-0",
                  walk.ok ? "bg-documented-soft" : "bg-contradicted-soft",
                )}
              >
                {finished ? (
                  <>
                    <p
                      className={cn(
                        "flex items-start gap-2 text-base font-medium",
                        walk.ok ? "text-documented" : "text-contradicted",
                      )}
                    >
                      {walk.ok ? (
                        <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      )}
                      {walk.ok
                        ? `Included. Entry #${entry.index} is part of the signed log.`
                        : "Verification failed. This entry is not what the log signed."}
                    </p>
                    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-1 text-sm">
                      <dt className="text-ink-2">Computed root</dt>
                      <dd>
                        <Hash value={walk.computedRoot} head={12} tail={10} label="computed root" />
                      </dd>
                      <dt className="text-ink-2">Signed root</dt>
                      <dd className="flex flex-wrap items-center gap-2">
                        <Hash value={latest.root_hash} head={12} tail={10} label="signed root" />
                        {signatureVerified === true ? (
                          <Badge tone="documented">
                            <CircleCheck aria-hidden="true" />
                            Signature checked
                          </Badge>
                        ) : (
                          <span className="text-xs text-ink-2">
                            Check the tree head signature to trust this root.
                          </span>
                        )}
                      </dd>
                    </dl>
                    <p className="max-w-[62ch] text-sm text-ink-2">
                      {walk.ok
                        ? `verifyInclusion() from @candor/crypto returned true for index ${entry.index} in a tree of ${latest.tree_size}. The server could not have produced these sibling hashes for a different entry.`
                        : "One changed byte gives a completely different leaf hash, so every hash above it changes too. Anyone holding the signed tree head would catch this edit."}
                    </p>
                    {!tampered && walk.serverLeafHash !== walk.originalLeafHash ? (
                      <p className="text-sm text-contradicted" role="alert">
                        The leaf hash sent by the server does not match these entry bytes.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-ink-2">Walking the path…</p>
                )}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </Sheet>
  );
}

function StepRow({
  state,
  tampered,
  title,
  formula,
  detail,
  sibling,
  value,
  first,
  last,
}: {
  state: "done" | "current" | "pending";
  tampered: boolean;
  title: string;
  formula: string;
  detail: string;
  sibling?: string;
  value: string;
  first?: boolean;
  last?: boolean;
}) {
  const dot =
    state === "pending"
      ? "border-line-strong bg-bg"
      : tampered
        ? "border-contradicted bg-contradicted"
        : "border-seal bg-seal";
  return (
    <li className="relative pb-4 pl-7">
      {!last ? (
        <span
          aria-hidden="true"
          className="absolute top-3 bottom-0 left-[4.5px] w-px bg-line-strong"
        />
      ) : null}
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1 left-0 size-2.5 rounded-full border-2 transition-colors duration-200",
          dot,
          state === "current" && "animate-[pulse-ring_1s_var(--ease-out-quart)_infinite]",
        )}
      />
      <div className={cn("flex min-w-0 flex-col gap-1", state === "pending" && "opacity-55")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm font-medium text-ink">{title}</span>
          <span className="font-mono text-2xs text-ink-3">{formula}</span>
        </div>
        <span className="text-xs text-ink-2">{detail}</span>
        <div className="flex flex-col gap-0.5 text-xs">
          {sibling ? (
            <span className="flex flex-wrap items-center gap-x-2">
              <span className="w-14 text-ink-3">Sibling</span>
              <Hash value={sibling} head={12} tail={10} label="sibling hash" />
            </span>
          ) : null}
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="w-14 text-ink-3">{first ? "Leaf" : "Result"}</span>
            {state === "pending" ? (
              <span className="font-mono text-xs text-ink-3">waiting</span>
            ) : (
              <Hash value={value} head={12} tail={10} label="computed hash" />
            )}
          </span>
        </div>
      </div>
    </li>
  );
}
