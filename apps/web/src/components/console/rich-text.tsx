"use client";

import { Fragment } from "react";

import { cn } from "@/lib/cn";
import { segmentPlaceholders } from "@/lib/pseudonyms";
import type { PseudonymEntry } from "@/lib/types";

const referencePattern =
  /\[((?:C\d{3,}|(?:D\d+|S)\.P\d{3,})(?:,\s*(?:C\d{3,}|(?:D\d+|S)\.P\d{3,}))*)\]/g;

export function EntityToken({
  placeholder,
  resolved,
}: {
  placeholder: string;
  resolved: string | null;
}) {
  if (resolved) {
    return (
      <span
        className="rounded-xs bg-seal-soft px-1 text-seal-ink decoration-seal/40 underline-offset-2"
        title={`${placeholder}, re-identified under quorum`}
      >
        {resolved}
      </span>
    );
  }
  return (
    <span
      className="rounded-xs bg-surface-2 px-1 font-mono text-[0.92em] text-ink"
      title="Pseudonym assigned on the reporter's device"
    >
      {placeholder}
    </span>
  );
}

export function PseudoText({
  text,
  map,
  className,
}: {
  text: string;
  map: PseudonymEntry[] | null;
  className?: string;
}) {
  return (
    <span className={className}>
      {segmentPlaceholders(text, map).map((segment, index) =>
        segment.placeholder ? (
          <EntityToken key={index} placeholder={segment.placeholder} resolved={segment.resolved} />
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </span>
  );
}

export function RefChip({
  id,
  onSelect,
  tone = "claim",
}: {
  id: string;
  onSelect?: (id: string) => void;
  tone?: "claim" | "passage";
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(id)}
      className={cn(
        "mx-[1px] inline-flex h-[1.35em] cursor-pointer items-center rounded-xs px-1 align-[0.08em] font-mono text-[0.78em] leading-none transition-colors duration-150",
        tone === "claim"
          ? "bg-seal-soft text-seal-ink hover:bg-seal hover:text-on-seal"
          : "bg-quarantine-soft text-quarantine hover:bg-quarantine hover:text-bg",
      )}
      aria-label={tone === "claim" ? `Open claim ${id}` : `Open passage ${id}`}
    >
      {id}
    </button>
  );
}

export function RichText({
  text,
  map,
  onClaim,
  onPassage,
  className,
}: {
  text: string;
  map: PseudonymEntry[] | null;
  onClaim?: (id: string) => void;
  onPassage?: (id: string) => void;
  className?: string;
}) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(referencePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push(<PseudoText key={key++} text={text.slice(cursor, index)} map={map} />);
    }
    const ids = (match[1] ?? "").split(/,\s*/);
    parts.push(
      <span key={key++} className="whitespace-nowrap">
        {ids.map((id) =>
          id.startsWith("C") ? (
            <RefChip key={id} id={id} onSelect={onClaim} />
          ) : (
            <RefChip key={id} id={id} onSelect={onPassage} tone="passage" />
          ),
        )}
      </span>,
    );
    cursor = index + match[0].length;
  }
  if (cursor < text.length)
    parts.push(<PseudoText key={key++} text={text.slice(cursor)} map={map} />);
  return <span className={className}>{parts}</span>;
}
