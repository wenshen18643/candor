"use client";

import { RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Skeleton } from "@/components/ui/field";
import {
  type Anchor,
  createAuditClient,
  loadCrypto,
  type LogEntry,
  type LogKey,
  type LogReviewer,
  recallTreeHead,
  rememberTreeHead,
  type SignedTreeHead,
} from "@/lib/audit-client";
import { truncateMiddle } from "@/lib/format";

import { AnchorsList } from "./anchors-list";
import { CheckStatus } from "./check-status";
import { type Check, type Checkpoint, idle } from "./checks";
import { ConsistencyPanel, type ConsistencyResult } from "./consistency-panel";
import { EntriesTable } from "./entries-table";
import { EntrySheet } from "./entry-sheet";
import { TreeHeadPanel } from "./tree-head-panel";

type Loaded = {
  key: LogKey;
  latest: SignedTreeHead;
  heads: SignedTreeHead[];
  entries: LogEntry[];
  anchors: Anchor[];
  reviewers: LogReviewer[];
  focusReportId: string | null;
  complete: boolean;
  remembered: SignedTreeHead | null;
};

type State =
  { status: "loading" } | { status: "error"; message: string } | ({ status: "ready" } & Loaded);

const rebuildLimit = 5000;

function buildCheckpoints(data: Loaded): Checkpoint[] {
  const map = new Map<string, Checkpoint>();
  const add = (
    size: number,
    root: string,
    timestamp: string,
    kind: Checkpoint["kinds"][number],
    sth: SignedTreeHead | null,
    chain: string | null,
  ) => {
    if (size <= 0 || size >= data.latest.tree_size) return;
    const id = `${size}:${root}`;
    const existing = map.get(id);
    if (existing) {
      if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
      existing.sth ??= sth;
      existing.chain ??= chain;
      return;
    }
    map.set(id, { id, tree_size: size, root_hash: root, timestamp, kinds: [kind], sth, chain });
  };
  for (const head of data.heads)
    add(head.tree_size, head.root_hash, head.timestamp, "signed", head, null);
  for (const anchor of data.anchors)
    add(anchor.tree_size, anchor.root_hash, anchor.created_at, "anchored", null, anchor.chain);
  if (data.remembered)
    add(
      data.remembered.tree_size,
      data.remembered.root_hash,
      data.remembered.timestamp,
      "remembered",
      data.remembered,
      null,
    );
  return [...map.values()].sort((a, b) => a.tree_size - b.tree_size);
}

export function AuditView() {
  const client = useMemo(() => createAuditClient(), []);
  const [state, setState] = useState<State>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [leafHashes, setLeafHashes] = useState<Map<number, string>>(new Map());
  const [signature, setSignature] = useState<Check>(idle);
  const [forgeCheck, setForgeCheck] = useState<Check>(idle);
  const [signatureVerified, setSignatureVerified] = useState<boolean | null>(null);
  const [rebuild, setRebuild] = useState<Check>(idle);
  const [consistency, setConsistency] = useState<Check>(idle);
  const [consistencyResult, setConsistencyResult] = useState<ConsistencyResult | null>(null);
  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  const [forged, setForged] = useState(false);
  const [checked, setChecked] = useState<Map<number, boolean>>(new Map());
  const [tamperRejected, setTamperRejected] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const [key, latest, heads, anchors, reviewers, focusReportId] = await Promise.all([
          client.getKey(),
          client.getLatestTreeHead(),
          client.getKnownTreeHeads(),
          client.getAnchors(),
          client.getReviewers(),
          client.getFocusReportId(),
        ]);
        const start = latest.tree_size > rebuildLimit ? latest.tree_size - 1000 : 0;
        const entries = await client.getEntries(start, latest.tree_size);
        const remembered = client.mode === "live" ? recallTreeHead() : null;
        if (cancelled) return;
        setState({
          status: "ready",
          key,
          latest,
          heads,
          entries,
          anchors,
          reviewers,
          focusReportId,
          complete: start === 0 && entries.length === latest.tree_size,
          remembered,
        });
      } catch (error) {
        if (!cancelled)
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "The log could not be loaded.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, reload]);

  const ready = state.status === "ready" ? state : null;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    loadCrypto().then((c) => {
      if (cancelled) return;
      const map = new Map<number, string>();
      for (const entry of ready.entries)
        map.set(entry.index, c.toHex(c.leafHash(c.b64u.decode(entry.leaf_b64u))));
      setLeafHashes(map);
    });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const checkpoints = useMemo(() => (ready ? buildCheckpoints(ready) : []), [ready]);

  useEffect(() => {
    if (checkpoints.length && !checkpoints.some((item) => item.id === checkpointId))
      setCheckpointId(checkpoints[0]!.id);
  }, [checkpoints, checkpointId]);

  const directory = useMemo(
    () => new Map((ready?.reviewers ?? []).map((reviewer) => [reviewer.reviewer_id, reviewer])),
    [ready],
  );

  const verifySignature = useCallback(
    async (forge: boolean) => {
      if (!ready) return false;
      const set = forge ? setForgeCheck : setSignature;
      set({ status: "running" });
      const c = await loadCrypto();
      const publicKey = c.b64u.decode(ready.key.public_key);
      const keyMatches = c.keyId(publicKey) === ready.key.key_id;
      const sth = forge ? { ...ready.latest, tree_size: ready.latest.tree_size + 1 } : ready.latest;
      const ok = keyMatches && c.verifySth(sth, publicKey);
      if (ok) {
        set({
          status: "pass",
          detail: `Valid Ed25519 signature by log key ${ready.key.key_id.slice(0, 8)} over a tree of ${sth.tree_size} with root ${truncateMiddle(sth.root_hash, 8, 6)}.`,
        });
        if (!forge) {
          setSignatureVerified(true);
          if (client.mode === "live") rememberTreeHead(ready.latest);
        }
      } else {
        set({
          status: "fail",
          detail: forge
            ? `The signature does not cover a tree of ${sth.tree_size}. A server that edits its own signed head is caught at once.`
            : keyMatches
              ? "The signature does not match this tree head. Do not trust this log until the operator explains."
              : "The log key does not match its published key ID.",
        });
        if (!forge) setSignatureVerified(false);
      }
      return ok;
    },
    [ready, client.mode],
  );

  const rebuildRoot = useCallback(async () => {
    if (!ready || !ready.complete) return false;
    setRebuild({ status: "running" });
    const c = await loadCrypto();
    const leaves = ready.entries
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((entry) => c.b64u.decode(entry.leaf_b64u));
    const root = c.toHex(c.merkleRoot(leaves));
    const ok = root === ready.latest.root_hash;
    setRebuild(
      ok
        ? {
            status: "pass",
            detail: `Hashed all ${leaves.length} entries into a root identical to the signed root.`,
          }
        : {
            status: "fail",
            detail: `The ${leaves.length} entries hash to ${truncateMiddle(root, 8, 6)}, not the signed root.`,
          },
    );
    return ok;
  }, [ready]);

  const checkConsistency = useCallback(
    async (id: string | null) => {
      if (!ready) return false;
      const first = checkpoints.find((item) => item.id === id);
      if (!first) return false;
      setConsistency({ status: "running" });
      try {
        const [c, proof] = await Promise.all([
          loadCrypto(),
          client.getConsistencyProof(first.tree_size, ready.latest.tree_size),
        ]);
        const publicKey = c.b64u.decode(ready.key.public_key);
        const headSignature = first.sth ? c.verifySth(first.sth, publicKey) : null;
        const ok =
          headSignature !== false &&
          c.verifyConsistency(
            first.tree_size,
            ready.latest.tree_size,
            c.fromHex(first.root_hash),
            c.fromHex(ready.latest.root_hash),
            proof.proof.map((value) => c.fromHex(value)),
          );
        setConsistencyResult({ first, proof: proof.proof, headSignature });
        setConsistency(
          ok
            ? {
                status: "pass",
                detail: `Consistent. The first ${first.tree_size} entries are unchanged inside today's tree of ${ready.latest.tree_size}: the log was only appended to, never rewritten.`,
              }
            : {
                status: "fail",
                detail:
                  headSignature === false
                    ? "The earlier tree head's signature is invalid, so it cannot anchor this check."
                    : `Not consistent. The tree of ${first.tree_size} is not a prefix of today's tree. History was rewritten, or the proof is wrong.`,
              },
        );
        return ok;
      } catch (error) {
        setConsistency({
          status: "fail",
          detail:
            error instanceof Error ? error.message : "The consistency proof could not be fetched.",
        });
        return false;
      }
    },
    [ready, checkpoints, client],
  );

  const runAll = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setForged(false);
    try {
      await verifySignature(false);
      await rebuildRoot();
      await checkConsistency(checkpointId ?? checkpoints[0]?.id ?? null);
    } finally {
      running.current = false;
    }
  }, [verifySignature, rebuildRoot, checkConsistency, checkpointId, checkpoints]);

  const onChecked = useCallback((index: number, ok: boolean, tampered: boolean) => {
    if (tampered) {
      if (!ok) setTamperRejected((value) => value + 1);
      return;
    }
    setChecked((previous) => new Map(previous).set(index, ok));
  }, []);

  const onForgedChange = (value: boolean) => {
    setForged(value);
    setForgeCheck(idle);
  };

  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error")
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-4 px-5 py-16 sm:px-8">
        <h1 className="text-2xl font-semibold">Transparency log</h1>
        <p className="max-w-[60ch] text-base text-contradicted" role="alert">
          {state.message}
        </p>
        <Button onClick={() => setReload((value) => value + 1)}>
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      </div>
    );

  const passedProofs = [...checked.values()].filter(Boolean).length;
  const failedProofs = [...checked.values()].filter((value) => !value).length;
  const proofCheck: Check =
    failedProofs > 0
      ? { status: "fail", detail: "" }
      : passedProofs > 0
        ? { status: "pass", detail: "" }
        : idle;
  const selectedEntry = state.entries.find((entry) => entry.index === selected) ?? null;
  const anyRunning =
    signature.status === "running" ||
    rebuild.status === "running" ||
    consistency.status === "running";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 pb-24 sm:px-8">
      <div className="grid gap-8 pt-8 pb-10 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
            Transparency log
          </h1>
          <p className="max-w-[52ch] text-md text-ink-2">
            Every report, analysis and evidence opening is recorded here, and nobody can quietly
            change it. Your browser checks that itself.
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            {client.mode === "showcase" ? (
              <>
                <Badge tone="seal">Showcase</Badge>
                Demo log. The checks are real.
              </>
            ) : (
              <>
                <Badge tone="info">Live</Badge>
                Reading the log at <span className="font-mono text-xs">{client.source}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-surface p-4">
          <h2 className="text-sm font-medium">Checked in this browser</h2>
          <ul className="flex flex-col gap-2 text-sm">
            <SummaryRow label="Signed by the log" check={signature} />
            <SummaryRow label="Entries add up" check={rebuild} />
            <SummaryRow label="Nothing rewritten" check={consistency} />
            <SummaryRow
              label={
                passedProofs + failedProofs > 0
                  ? `Entries checked (${passedProofs} of ${passedProofs + failedProofs})`
                  : "Entries checked"
              }
              check={proofCheck}
            />
          </ul>
          {tamperRejected > 0 ? (
            <p className="text-xs text-ink-2">
              Tampered copies rejected: <span className="tabular">{tamperRejected}</span>
            </p>
          ) : null}
          <Button variant="primary" onClick={runAll} loading={anyRunning} className="w-full">
            {anyRunning ? null : <ShieldCheck aria-hidden="true" />}
            Run all checks
          </Button>
        </div>
      </div>

      <EntriesTable
        entries={state.entries}
        leafHashes={leafHashes}
        directory={directory}
        focusReportId={state.focusReportId}
        checked={checked}
        selectedIndex={selected}
        onSelect={setSelected}
      />

      <Disclosure
        summary="Under the hood: signatures, history and anchors"
        className="mt-12"
        bodyClassName="flex flex-col gap-12 py-6"
      >
        <TreeHeadPanel
          latest={state.latest}
          logKey={state.key}
          signature={forged ? forgeCheck : signature}
          rebuild={rebuild}
          forged={forged}
          entryCount={state.entries.length}
          canRebuild={state.complete}
          onForgedChange={onForgedChange}
          onVerify={() => verifySignature(forged)}
          onRebuild={rebuildRoot}
        />
        <div className="grid gap-12 lg:grid-cols-2">
          <ConsistencyPanel
            latest={state.latest}
            checkpoints={checkpoints}
            selectedId={checkpointId}
            onSelect={(id) => {
              setCheckpointId(id);
              setConsistency(idle);
              setConsistencyResult(null);
            }}
            check={consistency}
            result={consistencyResult}
            onRun={() => checkConsistency(checkpointId)}
          />
          <AnchorsList anchors={state.anchors} heads={state.heads} />
        </div>
      </Disclosure>

      <EntrySheet
        key={selectedEntry?.index ?? "none"}
        entry={selectedEntry}
        latest={state.latest}
        client={client}
        directory={directory}
        signatureVerified={signatureVerified}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onChecked={onChecked}
      />
    </div>
  );
}

function SummaryRow({ label, check }: { label: string; check: Check }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-ink">{label}</span>
      <CheckStatus check={check} />
    </li>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 pt-12 sm:px-8" role="status">
      <span className="sr-only">Loading the transparency log</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-4 h-5 w-full max-w-[560px]" />
      <Skeleton className="mt-2 h-5 w-full max-w-[480px]" />
      <Skeleton className="mt-10 h-48 w-full rounded-xl" />
      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
