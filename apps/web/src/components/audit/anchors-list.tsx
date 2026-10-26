import { ArrowUpRight, CircleCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Hash } from "@/components/ui/hash";
import type { Anchor, SignedTreeHead } from "@/lib/audit-client";
import { formatDateTime } from "@/lib/format";

import { chainLabel, explorerUrl } from "./entry-meta";

export function AnchorsList({ anchors, heads }: { anchors: Anchor[]; heads: SignedTreeHead[] }) {
  const roots = new Map(heads.map((head) => [head.tree_size, head.root_hash]));
  return (
    <section aria-labelledby="anchors-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="anchors-heading" className="text-md font-semibold">
          Anchors
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          Every 16 entries the root is written to an outside chain. Even the log operator cannot
          later swap in a different history without the anchor disagreeing.
        </p>
      </div>
      {anchors.length === 0 ? (
        <p className="rounded-lg bg-surface px-4 py-3 text-sm text-ink-2">
          No anchors yet. The first one is published after 16 entries.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {[...anchors].reverse().map((anchor) => {
            const url = explorerUrl(anchor.chain, anchor.tx_ref);
            const known = roots.get(anchor.tree_size);
            return (
              <li
                key={`${anchor.tree_size}-${anchor.tx_ref}`}
                className="flex flex-col gap-1.5 px-3 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="tabular text-sm font-medium">
                    Root of {anchor.tree_size} entries
                  </span>
                  <Badge tone="outline">{chainLabel(anchor.chain)}</Badge>
                </div>
                <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-xs">
                  <dt className="text-ink-2">Root</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <Hash value={anchor.root_hash} head={10} tail={8} label="anchored root" />
                    {known === anchor.root_hash ? (
                      <span className="inline-flex items-center gap-1 text-documented">
                        <CircleCheck className="size-3" aria-hidden="true" />
                        matches signed head
                      </span>
                    ) : null}
                  </dd>
                  <dt className="text-ink-2">Transaction</dt>
                  <dd className="flex items-center gap-1">
                    <Hash value={anchor.tx_ref} head={10} tail={8} label="transaction reference" />
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-xs text-seal-ink hover:underline"
                      >
                        Explorer
                        <ArrowUpRight className="size-3" aria-hidden="true" />
                      </a>
                    ) : null}
                  </dd>
                  <dt className="text-ink-2">Published</dt>
                  <dd className="text-ink-2">{formatDateTime(anchor.created_at)}</dd>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
