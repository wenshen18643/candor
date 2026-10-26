"use client";

import { useMemo, useState } from "react";

import { ConfidenceMeter, EvidenceClassBadge, VerdictBadge } from "@/components/evidence/badges";
import { cn } from "@/lib/cn";
import { evidenceClassMeta } from "@/lib/evidence";
import { formatInterval } from "@/lib/format";
import type { AnalysisResult, EvidenceClass, PseudonymEntry, Verdict } from "@/lib/types";

import { PseudoText } from "./rich-text";

type Filter = "all" | "strong" | "weak" | "conflict";

const filters: { value: Filter; label: string; test: (value: EvidenceClass | null) => boolean }[] =
  [
    { value: "all", label: "All", test: () => true },
    {
      value: "strong",
      label: "Documented",
      test: (value) => value === "documented" || value === "corroborated",
    },
    {
      value: "weak",
      label: "Single source or alleged",
      test: (value) => value === "single_source" || value === "reporter_allegation",
    },
    {
      value: "conflict",
      label: "Contradicted or unsupported",
      test: (value) => value === "contradicted" || value === "unsupported",
    },
  ];

export function ClaimsTable({
  analysis,
  map,
  onClaim,
}: {
  analysis: AnalysisResult;
  map: PseudonymEntry[] | null;
  onClaim: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo(() => {
    const test = filters.find((item) => item.value === filter)?.test ?? (() => true);
    return analysis.claims
      .filter((claim) => test(claim.evidence_class as EvidenceClass | null))
      .sort((a, b) => {
        const rankA = a.evidence_class
          ? evidenceClassMeta[a.evidence_class as EvidenceClass].rank
          : 9;
        const rankB = b.evidence_class
          ? evidenceClassMeta[b.evidence_class as EvidenceClass].rank
          : 9;
        return rankA - rankB || (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0);
      });
  }, [analysis.claims, filter]);

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Filter claims" className="flex flex-wrap gap-1.5">
        {filters.map((item) => {
          const count = analysis.claims.filter((claim) =>
            item.test(claim.evidence_class as EvidenceClass | null),
          ).length;
          const active = filter === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setFilter(item.value)}
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm transition-colors duration-150",
                active
                  ? "border-ink bg-ink text-bg"
                  : "border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              {item.label}
              <span className={cn("tabular", active ? "text-bg/70" : "text-ink-3")}>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="scrollbar-quiet overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead className="bg-surface text-xs text-ink-2">
            <tr>
              <th scope="col" className="w-16 px-3 py-2 font-medium">
                ID
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Claim
              </th>
              <th scope="col" className="w-36 px-3 py-2 font-medium">
                Support
              </th>
              <th scope="col" className="w-32 px-3 py-2 font-medium">
                Verifier
              </th>
              <th scope="col" className="w-28 px-3 py-2 font-medium">
                Confidence
              </th>
              <th scope="col" className="w-36 px-3 py-2 font-medium">
                When
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((claim) => (
              <tr
                key={claim.claim_id}
                onClick={() => onClaim(claim.claim_id)}
                className="cursor-pointer border-t border-line align-top transition-colors duration-150 hover:bg-surface"
              >
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClaim(claim.claim_id);
                    }}
                    className="cursor-pointer font-mono text-xs text-seal-ink hover:underline"
                  >
                    {claim.claim_id}
                  </button>
                </td>
                <td className="px-3 py-3 text-base leading-6 text-ink">
                  <PseudoText text={claim.statement} map={map} />
                  <span className="mt-1 block text-xs text-ink-3">
                    {claim.citations.map((citation) => citation.passage_id).join(" · ")}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <EvidenceClassBadge value={claim.evidence_class as EvidenceClass} />
                </td>
                <td className="px-3 py-3">
                  <VerdictBadge value={claim.verification?.verdict as Verdict | undefined} />
                </td>
                <td className="px-3 py-3">
                  <ConfidenceMeter confidence={claim.confidence} />
                </td>
                <td className="tabular px-3 py-3 text-sm text-ink-2">
                  {claim.time ? formatInterval(claim.time.earliest, claim.time.latest) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
