import nlp from "compromise";
import { findPhoneNumbersInText } from "libphonenumber-js";

import type { Detection, PiiType, TextDocument } from "./types.js";

export const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const normalized = (text: string): string =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function termPattern(term: string, caseSensitive = false): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapePattern(term)}(?![\\p{L}\\p{N}_])`,
    caseSensitive ? "gu" : "giu",
  );
}

export interface SelfVariant {
  term: string;
  caseSensitive: boolean;
}

export function selfVariants(terms: string[]): SelfVariant[] {
  const variants = new Map<string, SelfVariant>();
  const add = (term: string, caseSensitive = false) => {
    if (term) variants.set(`${caseSensitive}:${term}`, { term, caseSensitive });
  };
  for (const raw of terms) {
    const term = raw.trim();
    add(term);
    if (term.includes("@")) add(term.split("@")[0]!);
    else if (/^[\d\s()+.-]+$/.test(term) && term.replace(/\D/g, "").length >= 7)
      add(term.replace(/\D/g, ""));
    else if (!/\d/.test(term))
      for (const token of term.split(/[^\p{L}]+/u).filter((part) => part.length >= 3)) {
        add(token[0]!.toUpperCase() + token.slice(1).toLowerCase(), true);
        add(token.toUpperCase(), true);
      }
  }
  return [...variants.values()];
}

function luhn(text: string): boolean {
  const digits = text.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let total = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - index - 1]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
  }
  return total % 10 === 0;
}

function iban(text: string): boolean {
  const compact = text.replace(/\s/g, "").toUpperCase();
  const lengths: Record<string, number> = {
    GB: 22,
    DE: 22,
    FR: 27,
    ES: 24,
    IT: 27,
    NL: 18,
    BE: 16,
    CH: 21,
    AT: 20,
    IE: 22,
    PT: 25,
    PL: 28,
    NO: 15,
    SE: 24,
    DK: 18,
    FI: 18,
    GR: 27,
    LU: 20,
    AE: 23,
    SA: 24,
    TR: 26,
  };
  if (
    compact.length < 15 ||
    compact.length > 34 ||
    (lengths[compact.slice(0, 2)] && compact.length !== lengths[compact.slice(0, 2)])
  )
    return false;
  const digits = (compact.slice(4) + compact.slice(0, 4)).replace(/[A-Z]/g, (letter) =>
    String(letter.charCodeAt(0) - 55),
  );
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

type Rule = { type: PiiType; pattern: RegExp; valid?: (text: string) => boolean };
const rules: Rule[] = [
  { type: "email", pattern: /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g },
  { type: "url", pattern: /\bhttps?:\/\/[^\s<>"']+/gi },
  { type: "id", pattern: /\b(?:EMP|BADGE|STAFF)[-_ ]?\d{3,12}\b/gi },
  {
    type: "id",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    valid: (value) => !/^(000|666|9\d\d)-|^\d{3}-00-|\b0000$/.test(value),
  },
  {
    type: "ip",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    valid: (value) => value.split(".").every((part) => Number(part) <= 255),
  },
  {
    type: "ip",
    pattern: /(?<![\w:])(?:[\da-f]{0,4}:){2,7}[\da-f]{0,4}(?![\w:])/gi,
    valid: (value) => {
      try {
        return new URL(`http://[${value}]/`).hostname.length > 0;
      } catch {
        return false;
      }
    },
  },
  { type: "account", pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, valid: iban },
  { type: "account", pattern: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, valid: luhn },
  {
    type: "date_of_birth",
    pattern:
      /(?<=\b(?:DOB|born|date of birth)[:\s]+)(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[A-Z][a-z]+ \d{1,2},? \d{4})/gi,
  },
];
const stopwords = new Set([
  "i",
  "we",
  "he",
  "she",
  "they",
  "it",
  "this",
  "that",
  "the",
  "a",
  "an",
  "dear",
  "hello",
  "thanks",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

export function resolveOverlaps(detections: Detection[]): Detection[] {
  const priority = (hit: Detection): number =>
    hit.source === "self" ? 4 : hit.source === "custom" ? 3 : hit.source === "regex" ? 2 : 1;
  const selected: Detection[] = [];
  for (const hit of [...detections].sort(
    (a, b) => priority(b) - priority(a) || b.end - b.start - (a.end - a.start) || a.start - b.start,
  )) {
    if (
      !selected.some(
        (other) => other.docKey === hit.docKey && hit.start < other.end && hit.end > other.start,
      )
    )
      selected.push(hit);
  }
  return selected.sort((a, b) => a.start - b.start);
}

export function detectPii(
  docs: TextDocument[],
  options: { selfTerms: string[]; customTerms?: string[] },
): Detection[] {
  if (new Set(docs.map((doc) => doc.docKey)).size !== docs.length)
    throw new Error("Duplicate document keys");
  const result: Detection[] = [];
  for (const [docIndex, doc] of docs.entries()) {
    const hits: Detection[] = [];
    const add = (
      type: PiiType,
      start: number,
      end: number,
      source: Detection["source"],
      confidence: number,
    ): void => {
      if (/^(?:[A-Z]+_\d+|REDACTED)$/.test(doc.text.slice(start, end))) return;
      hits.push({
        id: "",
        docKey: doc.docKey,
        type,
        text: doc.text.slice(start, end),
        start,
        end,
        source,
        confidence,
      });
    };
    for (const rule of rules)
      for (const match of doc.text.matchAll(rule.pattern)) {
        const text = rule.type === "url" ? match[0].replace(/[.,;!?)]+$/, "") : match[0];
        if (!rule.valid || rule.valid(text))
          add(rule.type, match.index, match.index + text.length, "regex", 0.98);
      }
    for (const hit of findPhoneNumbersInText(doc.text, "US"))
      add("phone", hit.startsAt, hit.endsAt, "regex", 0.95);
    const parsed = nlp(doc.text);
    const entities: [PiiType, string[]][] = [
      ["person", parsed.people().out("array") as string[]],
      ["org", parsed.organizations().out("array") as string[]],
      ["place", parsed.places().out("array") as string[]],
    ];
    for (const [type, terms] of entities)
      for (const raw of terms) {
        const term = raw.replace(/^[^\p{L}\p{N}]+|[\s.,;:!?]+$/gu, "");
        if (!term || stopwords.has(term.toLowerCase()) || !/\p{Lu}/u.test(term)) continue;
        for (const match of doc.text.matchAll(termPattern(term)))
          add(type, match.index, match.index + match[0].length, "ner", 0.8);
      }
    for (const term of options.customTerms ?? [])
      if (term.trim())
        for (const match of doc.text.matchAll(termPattern(term.trim())))
          add("other", match.index, match.index + match[0].length, "custom", 1);
    for (const { term, caseSensitive } of selfVariants(options.selfTerms)) {
      const pattern = /^\d{7,}$/.test(term)
        ? new RegExp(`(?<!\\d)${term.split("").join("[\\s()+.-]*")}(?!\\d)`, "g")
        : termPattern(term, caseSensitive);
      for (const match of doc.text.matchAll(pattern))
        add("person", match.index, match.index + match[0].length, "self", 1);
    }
    for (const hit of hits.filter((candidate) => candidate.source === "self")) {
      const containing = hits
        .filter(
          (candidate) =>
            candidate.source !== "self" && candidate.start <= hit.start && candidate.end >= hit.end,
        )
        .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      if (containing) {
        hit.start = containing.start;
        hit.end = containing.end;
        hit.text = containing.text;
      }
    }
    result.push(
      ...resolveOverlaps(hits).map((hit, index) => ({
        ...hit,
        id: `d${docIndex + 1}-${index + 1}`,
      })),
    );
  }
  return result;
}
