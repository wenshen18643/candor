"use client";

import { CircleAlert, ShieldAlert } from "lucide-react";

import { EvidenceClassBadge } from "@/components/evidence/badges";
import { evidenceClassMeta } from "@/lib/evidence";
import { formatDuration, pluralize } from "@/lib/format";
import type { AnalysisResult, EvidenceClass, PseudonymEntry } from "@/lib/types";

import { PseudoText, RefChip, RichText } from "./rich-text";

const classOrder: EvidenceClass[] = [
  "corroborated",
  "documented",
  "single_source",
  "reporter_allegation",
  "contradicted",
  "unsupported",
];

const classFill: Record<EvidenceClass, string> = {
  corroborated: "bg-documented",
  documented: "bg-documented/60",
  single_source: "bg-info/70",
  reporter_allegation: "bg-allegation/80",
  contradicted: "bg-contradicted/80",
  unsupported: "bg-unsupported/50",
};

function EvidenceProfile({ analysis }: { analysis: AnalysisResult }) {
  const counts = classOrder.map((value) => ({
    value,
    count: analysis.claims.filter((claim) => claim.evidence_class === value).length,
  }));
  const total = Math.max(1, analysis.claims.length);
  return (
    <section aria-labelledby="profile-heading">
      <h3 id="profile-heading" className="text-sm font-semibold text-ink">
        Evidence profile
      </h3>
      <p className="mt-0.5 text-sm text-ink-2">
        {pluralize(analysis.claims.length, "claim")} by strength of support
      </p>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        {counts
          .filter((item) => item.count > 0)
          .map((item) => (
            <span
              key={item.value}
              className={classFill[item.value]}
              style={{ width: `${(item.count / total) * 100}%` }}
            />
          ))}
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {counts.map((item) => (
          <li key={item.value} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-ink-2">
              <span className={`size-2 rounded-full ${classFill[item.value]}`} aria-hidden="true" />
              {evidenceClassMeta[item.value].label}
            </span>
            <span className="tabular text-ink">{item.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RunFacts({ analysis }: { analysis: AnalysisResult }) {
  const models = Array.from(
    new Set(analysis.stages.filter((stage) => stage.model).map((stage) => stage.model)),
  );
  const calls = analysis.stages.reduce((sum, stage) => sum + stage.llm_calls, 0);
  const repairs = analysis.stages.reduce((sum, stage) => sum + stage.repairs, 0);
  const facts = [
    {
      label: "Quotes verified",
      value: `${analysis.metrics.citations_verified} / ${analysis.metrics.citations_total}`,
    },
    { label: "Model calls", value: String(calls) },
    { label: "Schema repairs", value: String(repairs) },
    { label: "Run time", value: formatDuration(analysis.metrics.total_duration_ms) },
    { label: "Model", value: models.join(", ") || "—" },
  ];
  return (
    <section aria-labelledby="run-heading">
      <h3 id="run-heading" className="text-sm font-semibold text-ink">
        This run
      </h3>
      <dl className="mt-2 flex flex-col">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline justify-between gap-3 py-1 text-sm">
            <dt className="text-ink-2">{fact.label}</dt>
            <dd className="tabular text-right font-mono text-xs text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Brief({
  analysis,
  map,
  onClaim,
  onPassage,
}: {
  analysis: AnalysisResult;
  map: PseudonymEntry[] | null;
  onClaim: (id: string) => void;
  onPassage: (id: string) => void;
}) {
  const { summary } = analysis;
  const quarantined = analysis.injection_findings.filter((finding) => finding.quarantined);
  const highContradictions = analysis.contradictions.filter((item) => item.severity !== "low");
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
      <article className="min-w-0">
        <h2 className="max-w-[40ch] text-2xl leading-tight font-semibold tracking-[-0.01em] text-ink">
          <PseudoText text={summary.headline} map={map} />
        </h2>
        <p className="mt-4 max-w-[68ch] text-md leading-7 text-ink-2">
          <RichText text={summary.overview} map={map} onClaim={onClaim} onPassage={onPassage} />
        </p>

        <h3 className="mt-8 text-base font-semibold">What the evidence shows</h3>
        <ol className="mt-3 flex max-w-[72ch] flex-col">
          {summary.key_points.map((point, index) => (
            <li
              key={index}
              className="grid grid-cols-[28px_1fr] gap-2 border-t border-line py-3 text-base leading-6 first:border-t-0"
            >
              <span className="tabular pt-px font-mono text-xs text-ink-3">
                {String(index + 1).padStart(2, "0")}
              </span>
              <RichText text={point} map={map} onClaim={onClaim} onPassage={onPassage} />
            </li>
          ))}
        </ol>

        {highContradictions.length > 0 ? (
          <>
            <h3 className="mt-8 text-base font-semibold">Where the evidence disagrees</h3>
            <ul className="mt-3 flex max-w-[72ch] flex-col gap-3">
              {highContradictions.map((item) => (
                <li
                  key={item.contradiction_id}
                  className="rounded-lg bg-contradicted-soft/60 px-4 py-3 text-base leading-6"
                >
                  <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-contradicted">
                    <CircleAlert className="size-4" aria-hidden="true" />
                    {item.severity === "high" ? "Significant conflict" : "Conflict"}
                  </span>
                  <PseudoText text={item.description} map={map} className="text-ink" />{" "}
                  {item.claim_ids.map((id) => (
                    <RefChip key={id} id={id} onSelect={onClaim} />
                  ))}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <section>
            <h3 className="text-base font-semibold">What the evidence does not show</h3>
            <ul className="mt-3 flex flex-col gap-2 text-base leading-6 text-ink-2">
              {summary.limitations.map((item, index) => (
                <li key={index} className="flex gap-2">
                  <span
                    className="mt-2.5 size-1 shrink-0 rounded-full bg-ink-3"
                    aria-hidden="true"
                  />
                  <RichText text={item} map={map} onClaim={onClaim} onPassage={onPassage} />
                </li>
              ))}
            </ul>
          </section>
          {summary.risk_notes.length > 0 ? (
            <section>
              <h3 className="text-base font-semibold">Handle with care</h3>
              <ul className="mt-3 flex flex-col gap-2 text-base leading-6 text-ink-2">
                {summary.risk_notes.map((item, index) => (
                  <li key={index} className="flex gap-2">
                    <span
                      className="mt-2.5 size-1 shrink-0 rounded-full bg-allegation"
                      aria-hidden="true"
                    />
                    <RichText text={item} map={map} onClaim={onClaim} onPassage={onPassage} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <p className="mt-10 max-w-[68ch] border-t border-line pt-4 text-sm text-ink-3">
          This brief organises evidence. It doesn&apos;t judge anyone; that&apos;s your call.
        </p>
      </article>

      <aside className="flex flex-col gap-8 lg:border-l lg:border-line lg:pl-8">
        <EvidenceProfile analysis={analysis} />
        {quarantined.length > 0 ? (
          <section className="rounded-lg bg-quarantine-soft/60 p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-quarantine">
              <ShieldAlert className="size-4" aria-hidden="true" />
              {pluralize(quarantined.length, "passage")} quarantined
            </h3>
            <p className="mt-1 text-sm text-ink-2">
              Text that tried to give the AI orders. Kept as evidence, never obeyed.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {quarantined.map((finding) => (
                <RefChip
                  key={finding.passage_id}
                  id={finding.passage_id}
                  tone="passage"
                  onSelect={onPassage}
                />
              ))}
            </div>
          </section>
        ) : null}
        <section>
          <h3 className="text-sm font-semibold text-ink">Claims needing attention</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {analysis.claims
              .filter((claim) =>
                ["contradicted", "unsupported", "reporter_allegation"].includes(
                  claim.evidence_class ?? "",
                ),
              )
              .slice(0, 5)
              .map((claim) => (
                <li key={claim.claim_id}>
                  <button
                    type="button"
                    onClick={() => onClaim(claim.claim_id)}
                    className="-m-2 w-full cursor-pointer rounded-md p-2 text-left hover:bg-surface-2"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-ink-3">{claim.claim_id}</span>
                      <EvidenceClassBadge value={claim.evidence_class as EvidenceClass} />
                    </span>
                    <PseudoText
                      text={claim.statement}
                      map={map}
                      className="mt-1 line-clamp-2 block text-sm text-ink-2"
                    />
                  </button>
                </li>
              ))}
          </ul>
        </section>
        <RunFacts analysis={analysis} />
      </aside>
    </div>
  );
}
