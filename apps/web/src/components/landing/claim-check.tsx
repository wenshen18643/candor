import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import { PseudoText } from "@/components/console/rich-text";
import { ConfidenceMeter, EvidenceClassBadge } from "@/components/evidence/badges";

import { buildTrace } from "./pipeline-data";

const deeper = [
  { href: "/architecture", label: "How it works" },
  { href: "/evals", label: "Test results" },
  { href: "/audit", label: "Public log" },
];

export function ClaimCheck() {
  const trace = buildTrace("C003");
  const citation = trace?.citations[0];
  if (!trace || !citation) return null;
  const checks = [
    `Found in ${trace.agreeing} of ${trace.samples} separate readings`,
    "Quote matches the email word for word",
    "Confirmed by a second, independent check",
  ];
  return (
    <section aria-labelledby="claim-title" className="bg-surface">
      <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div>
          <h2
            id="claim-title"
            className="text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl"
          >
            Every line points to its proof
          </h2>
          <p className="mt-4 max-w-[40ch] text-md text-ink-2">
            Meta’s Muse model reads the evidence, and code checks every line it writes. This is one
            real line from the demo report.
          </p>
          <nav aria-label="Learn more" className="mt-8 flex flex-col items-start gap-2">
            {deeper.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex items-center gap-1.5 rounded-xs text-md font-medium text-ink transition-colors duration-150 hover:text-seal-ink"
              >
                {link.label}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            ))}
          </nav>
        </div>
        <figure className="min-w-0 rounded-xl bg-bg p-5 sm:p-7 dark:bg-surface-2">
          <PseudoText text={trace.statement} map={null} className="text-lg leading-8 font-medium" />
          <blockquote className="mt-5 rounded-md bg-surface-2 px-4 py-3 text-sm leading-6 text-ink-2 dark:bg-surface-3">
            {citation.text.slice(0, citation.start)}
            <mark className="rounded-xs bg-documented-soft text-documented">
              {citation.text.slice(citation.start, citation.end)}
            </mark>
            {citation.text.slice(citation.end)}
          </blockquote>
          <figcaption className="mt-1.5 text-xs text-ink-3">{citation.docLabel}</figcaption>
          <ul className="mt-6 flex flex-col gap-2.5">
            {checks.map((check) => (
              <li key={check} className="flex items-start gap-2.5 text-md text-ink">
                <Check className="mt-1 size-4 shrink-0 text-documented" aria-hidden="true" />
                {check}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line pt-5">
            <ConfidenceMeter
              confidence={{
                score: trace.score,
                sample_agreement: trace.agreement,
                independent_sources: trace.sources,
                label: trace.label,
                statement: trace.confidenceStatement,
              }}
            />
            <EvidenceClassBadge value={trace.evidenceClass} />
          </div>
        </figure>
      </div>
    </section>
  );
}
