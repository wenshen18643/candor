"use client";

import { CircleCheck, CircleX } from "lucide-react";

import { QuarantineBadge } from "@/components/evidence/badges";
import { Hash } from "@/components/ui/hash";
import { cn } from "@/lib/cn";
import type { Citation, Passage, PseudonymEntry } from "@/lib/types";

import { PseudoText } from "./rich-text";

function locateQuote(passage: Passage, citation: Citation) {
  if (
    citation.quote_verified &&
    citation.match_start !== null &&
    citation.match_end !== null &&
    passage.text.slice(citation.match_start, citation.match_end) === citation.quote
  ) {
    return { start: citation.match_start, end: citation.match_end };
  }
  const index = passage.text.indexOf(citation.quote);
  return index >= 0 ? { start: index, end: index + citation.quote.length } : null;
}

export function PassageQuote({
  passage,
  citation,
  map,
  docTitle,
}: {
  passage: Passage | undefined;
  citation: Citation;
  map: PseudonymEntry[] | null;
  docTitle?: string;
}) {
  if (!passage) {
    return (
      <div className="rounded-lg border border-line p-3 text-sm text-ink-2">
        Passage {citation.passage_id} is not in this analysis.
      </div>
    );
  }
  const range = locateQuote(passage, citation);
  const quarantined = passage.injection_risk >= 0.7;
  return (
    <figure
      className={cn(
        "rounded-lg border p-3",
        quarantined ? "border-quarantine/40 bg-quarantine-soft/40" : "border-line bg-surface",
      )}
    >
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
        <span className="font-mono font-medium text-ink">{passage.passage_id}</span>
        {docTitle ? <PseudoText className="truncate" text={docTitle} map={map} /> : null}
        <span className="ml-auto inline-flex items-center gap-1.5">
          {citation.quote_verified ? (
            <span className="inline-flex items-center gap-1 text-documented">
              <CircleCheck className="size-3.5" aria-hidden="true" />
              Quote matches verbatim
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-contradicted">
              <CircleX className="size-3.5" aria-hidden="true" />
              Quote not found in passage
            </span>
          )}
        </span>
      </figcaption>
      {quarantined ? <QuarantineBadge /> : null}
      <blockquote className="mt-1 text-base leading-6 whitespace-pre-wrap text-ink-2">
        {range ? (
          <>
            <PseudoText text={passage.text.slice(0, range.start)} map={map} />
            <mark className="rounded-xs bg-allegation-soft px-0.5 text-ink ring-1 ring-allegation/30">
              <PseudoText text={passage.text.slice(range.start, range.end)} map={map} />
            </mark>
            <PseudoText text={passage.text.slice(range.end)} map={map} />
          </>
        ) : (
          <PseudoText text={passage.text} map={map} />
        )}
      </blockquote>
      <div className="mt-2 flex items-center gap-2 text-2xs text-ink-3">
        <span>sha256</span>
        <Hash value={passage.sha256} label="passage hash" />
        <span className="tabular ml-auto">
          chars {passage.char_start}–{passage.char_end}
        </span>
      </div>
    </figure>
  );
}
