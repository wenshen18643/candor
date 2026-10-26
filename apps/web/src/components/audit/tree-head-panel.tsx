"use client";

import { Layers, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Hash } from "@/components/ui/hash";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import type { LogKey, SignedTreeHead } from "@/lib/audit-client";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

import { CheckStatus } from "./check-status";
import type { Check } from "./checks";

export function TreeHeadPanel({
  latest,
  logKey,
  signature,
  rebuild,
  forged,
  entryCount,
  canRebuild,
  onForgedChange,
  onVerify,
  onRebuild,
}: {
  latest: SignedTreeHead;
  logKey: LogKey;
  signature: Check;
  rebuild: Check;
  forged: boolean;
  entryCount: number;
  canRebuild: boolean;
  onForgedChange: (value: boolean) => void;
  onVerify: () => void;
  onRebuild: () => void;
}) {
  const shownSize = forged ? latest.tree_size + 1 : latest.tree_size;
  return (
    <section aria-labelledby="sth-heading" className="rounded-xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h2 id="sth-heading" className="text-md font-semibold">
            Latest signed tree head
          </h2>
          <p className="text-sm text-ink-2">
            The log server&apos;s signed promise about every entry so far.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={onRebuild}
            loading={rebuild.status === "running"}
            disabled={!canRebuild}
          >
            {rebuild.status === "running" ? null : <Layers aria-hidden="true" />}
            Rebuild root
          </Button>
          <Button variant="primary" onClick={onVerify} loading={signature.status === "running"}>
            {signature.status === "running" ? null : <ShieldCheck aria-hidden="true" />}
            Verify signature
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-line lg:grid-cols-[repeat(2,minmax(0,0.7fr))_repeat(2,minmax(0,1fr))]">
        <Cell label="Tree size">
          <span
            className={cn(
              "tabular text-xl font-semibold",
              forged && "text-contradicted underline decoration-2 underline-offset-4",
            )}
          >
            {shownSize}
          </span>
          <span className="ml-1.5 text-sm text-ink-2">entries</span>
        </Cell>
        <Cell label="Signed at">
          <span className="text-sm text-ink">{formatDateTime(latest.timestamp)}</span>
        </Cell>
        <Cell label="Root hash">
          <Hash value={latest.root_hash} head={14} tail={10} label="root hash" />
        </Cell>
        <Cell label="Log key ID">
          <Hash value={latest.key_id} head={14} tail={8} label="log key ID" />
          {latest.key_id !== logKey.key_id ? (
            <span className="mt-1 block text-xs text-contradicted">
              Does not match the published log key
            </span>
          ) : null}
        </Cell>
      </dl>

      <div className="grid gap-6 border-t border-line px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Exactly what was signed</h3>
            <span className="font-mono text-2xs text-ink-3">Ed25519</span>
          </div>
          <pre className="scrollbar-quiet overflow-x-auto rounded-lg bg-surface px-3 py-2.5 font-mono text-xs leading-5 text-ink-2">
            <span className="text-ink-3">candor/v1/sth</span>
            {"\n"}
            <span
              className={cn(
                forged ? "rounded-[2px] bg-contradicted-soft text-contradicted" : "text-ink",
              )}
            >
              {shownSize}
            </span>
            {"\n"}
            <span className="break-all whitespace-pre-wrap text-ink">{latest.root_hash}</span>
            {"\n"}
            <span className="text-ink">{latest.timestamp}</span>
          </pre>
          <ToggleSwitch
            id="forge-head"
            tone="contradicted"
            checked={forged}
            onCheckedChange={onForgedChange}
            label="Forge the tree size"
            description="Claim one more entry than the server signed, then verify again."
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4" aria-live="polite">
          <Outcome
            title="Signature"
            check={signature}
            idleText="Checks the Ed25519 signature over the four lines on the left with the log's public key, inside your browser."
          />
          <Outcome
            title="Root rebuilt from entries"
            check={rebuild}
            idleText={
              canRebuild
                ? `Hashes all ${entryCount} entries into a Merkle tree and compares the result with the signed root.`
                : "Too many entries to rebuild in the browser; use inclusion and consistency proofs instead."
            }
          />
        </div>
      </div>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-bg px-4 py-3 sm:px-5">
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Outcome({ title, check, idleText }: { title: string; check: Check; idleText: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{title}</span>
        <CheckStatus check={check} />
      </div>
      <p className={cn("text-sm", check.status === "fail" ? "text-contradicted" : "text-ink-2")}>
        {check.status === "pass" || check.status === "fail" ? check.detail : idleText}
      </p>
    </div>
  );
}
