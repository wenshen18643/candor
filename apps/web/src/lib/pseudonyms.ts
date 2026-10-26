import type { PseudonymEntry } from "./types";

const placeholderPattern = /\b(PERSON|ORG|EMAIL|PHONE|ID|ACCOUNT|URL|PLACE|IP)_\d+\b/g;

export type TextSegment = { text: string; placeholder: string | null; resolved: string | null };

export function segmentPlaceholders(text: string, map: PseudonymEntry[] | null): TextSegment[] {
  const lookup = new Map(map?.map((entry) => [entry.placeholder, entry.value]) ?? []);
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(placeholderPattern)) {
    const index = match.index ?? 0;
    if (index > cursor)
      segments.push({ text: text.slice(cursor, index), placeholder: null, resolved: null });
    const placeholder = match[0];
    segments.push({ text: placeholder, placeholder, resolved: lookup.get(placeholder) ?? null });
    cursor = index + placeholder.length;
  }
  if (cursor < text.length)
    segments.push({ text: text.slice(cursor), placeholder: null, resolved: null });
  return segments;
}

export function resolvePlaceholder(placeholder: string, map: PseudonymEntry[] | null) {
  return map?.find((entry) => entry.placeholder === placeholder)?.value ?? null;
}
