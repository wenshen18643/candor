"use client";

import { ArrowRight, Flag } from "lucide-react";

import { ConfidenceMeter, EvidenceClassBadge, VerdictBadge } from "@/components/evidence/badges";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { evidenceClassMeta } from "@/lib/evidence";
import { formatInterval } from "@/lib/format";
import type { AnalysisResult, Claim, EvidenceClass, PseudonymEntry, Verdict } from "@/lib/types";

import { PassageQuote } from "./passage-quote";
import { EntityToken, PseudoText, RefChip } from "./rich-text";

const flagLabels: Record<string, string> = {
  cites_injected_passage: "Relies on a quarantined passage",
  secondhand_account: "Secondhand account",
  inference: "Inference, not a direct statement",
  assertion_not_fact: "Records an assertion, not that it happened",
  invalid_citation: "Had an invalid citation (removed)",
  unverified_quote: "No quote could be verified",
};

const relationLabels: Record<string, string> = {
  before: "Happened before",
  after: "Happened after",
  during: "Happened during",
  same_time: "Same time as",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 py-2.5 text-base">
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function ClaimSheet({
  claim,
  analysis,
  map,
  open,
  onOpenChange,
  onClaim,
}: {
  claim: Claim | null;
  analysis: AnalysisResult;
  map: PseudonymEntry[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClaim: (id: string) => void;
}) {
  if (!claim) return null;
  const passages = new Map(analysis.passages.map((passage) => [passage.passage_id, passage]));
  const titles = new Map((analysis.documents ?? []).map((doc) => [doc.doc_id, doc.title]));
  const evidenceClass = claim.evidence_class as EvidenceClass | null;
  const contradictions = analysis.contradictions.filter((item) =>
    item.claim_ids.includes(claim.claim_id),
  );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title={
        <span className="flex items-center gap-2">
          <span className="font-mono text-ink-2">{claim.claim_id}</span>
          <span>Claim detail</span>
        </span>
      }
      description={evidenceClass ? evidenceClassMeta[evidenceClass].description : undefined}
    >
      <p className="text-lg leading-7 text-ink">
        <PseudoText text={claim.statement} map={map} />
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <EvidenceClassBadge value={evidenceClass} />
        <Badge tone="outline">{claim.kind}</Badge>
        <Badge tone="outline">
          {claim.source_type === "reporter_statement"
            ? "From reporter's statement"
            : claim.source_type === "mixed"
              ? "Statement and documents"
              : "From documents"}
        </Badge>
      </div>

      <dl className="mt-5 divide-y divide-line border-y border-line">
        <Row label="Verifier">
          <div className="flex flex-col gap-1">
            <VerdictBadge value={claim.verification?.verdict as Verdict | undefined} />
            <p className="text-ink-2">
              <PseudoText text={claim.verification?.rationale ?? "Not verified."} map={map} />
            </p>
          </div>
        </Row>
        <Row label="Confidence">
          <div className="flex flex-col gap-1">
            <ConfidenceMeter confidence={claim.confidence} />
            <p className="text-ink-2">{claim.confidence?.statement}</p>
          </div>
        </Row>
        <Row label="When">
          {claim.time ? (
            <span>
              {formatInterval(claim.time.earliest, claim.time.latest)}
              <span className="ml-2 text-ink-3">
                from “{claim.time.source_text}”, {claim.time.granularity} precision
              </span>
            </span>
          ) : (
            <span className="text-ink-3">No date in the evidence</span>
          )}
        </Row>
        {claim.actors.length + claim.targets.length > 0 ? (
          <Row label="Who">
            <span className="flex flex-wrap items-center gap-1.5">
              {claim.actors.map((actor) => (
                <EntityToken
                  key={actor}
                  placeholder={actor}
                  resolved={map?.find((entry) => entry.placeholder === actor)?.value ?? null}
                />
              ))}
              {claim.targets.length > 0 ? (
                <ArrowRight className="size-3.5 text-ink-3" aria-label="acted on" />
              ) : null}
              {claim.targets.map((target) => (
                <EntityToken
                  key={target}
                  placeholder={target}
                  resolved={map?.find((entry) => entry.placeholder === target)?.value ?? null}
                />
              ))}
              <span className="text-ink-2">· {claim.action}</span>
            </span>
          </Row>
        ) : null}
        {claim.temporal_links.length > 0 ? (
          <Row label="Order">
            <ul className="flex flex-col gap-1">
              {claim.temporal_links.map((link) => (
                <li key={`${link.relation}-${link.other_claim_id}`}>
                  {relationLabels[link.relation]}{" "}
                  <RefChip id={link.other_claim_id} onSelect={onClaim} />
                  {link.evidence_passage_id ? (
                    <span className="text-ink-3"> per {link.evidence_passage_id}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
        {claim.flags.length > 0 ? (
          <Row label="Flags">
            <ul className="flex flex-col gap-1">
              {claim.flags.map((flag) => (
                <li key={flag} className="inline-flex items-center gap-1.5 text-ink-2">
                  <Flag className="size-3.5 text-allegation" aria-hidden="true" />
                  {flagLabels[flag] ?? flag}
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
        {contradictions.length > 0 ? (
          <Row label="Conflicts">
            <ul className="flex flex-col gap-2">
              {contradictions.map((item) => (
                <li key={item.contradiction_id} className="text-ink-2">
                  <Badge tone="contradicted" className="mr-1.5">
                    {item.severity}
                  </Badge>
                  <PseudoText text={item.description} map={map} />{" "}
                  {item.claim_ids
                    .filter((id) => id !== claim.claim_id)
                    .map((id) => (
                      <RefChip key={id} id={id} onSelect={onClaim} />
                    ))}
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
      </dl>

      <h3 className="mt-6 mb-2 text-base font-semibold">
        Sources <span className="font-normal text-ink-2">({claim.citations.length})</span>
      </h3>
      <div className="flex flex-col gap-3">
        {claim.citations.map((citation, index) => {
          const passage = passages.get(citation.passage_id);
          return (
            <PassageQuote
              key={`${citation.passage_id}-${index}`}
              passage={passage}
              citation={citation}
              map={map}
              docTitle={passage ? titles.get(passage.doc_id) : undefined}
            />
          );
        })}
      </div>
    </Sheet>
  );
}
