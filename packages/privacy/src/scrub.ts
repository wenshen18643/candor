import { normalized, resolveOverlaps, termPattern } from "./detect.js";
import type {
  Detection,
  PiiType,
  PseudonymEntry,
  RedactionDecision,
  ScrubResult,
  TextDocument,
} from "./types.js";

const prefix = (type: PiiType): string =>
  type === "date_of_birth" || type === "ip" ? "OTHER" : type.toUpperCase();

function identity(type: PiiType, text: string): string {
  const value =
    type === "phone"
      ? text.replace(/\D/g, "")
      : type === "account"
        ? normalized(text)
        : type === "url"
          ? text
          : text.toLowerCase().trim().replace(/\s+/g, " ");
  return `${type}:${value}`;
}

function buildRegistry(hits: Detection[]): {
  entries: PseudonymEntry[];
  lookup: Map<string, PseudonymEntry>;
} {
  const entries: PseudonymEntry[] = [];
  const lookup = new Map<string, PseudonymEntry>();
  const used = new Map<string, Set<number>>();
  const sorted = [...hits].sort(
    (a, b) =>
      Number(b.type === "person") - Number(a.type === "person") ||
      (a.type === "person" ? b.text.split(/\s+/).length - a.text.split(/\s+/).length : 0),
  );
  for (const hit of sorted) {
    const key = identity(hit.type, hit.text);
    if (lookup.has(key)) continue;
    let linked: PseudonymEntry | undefined;
    if (hit.type === "person" && !hit.text.trim().includes(" ")) {
      const matches = entries.filter(
        (entry) =>
          entry.type === "person" &&
          entry.value.split(/\s+/).some((part) => normalized(part) === normalized(hit.text)),
      );
      if (matches.length === 1) linked = matches[0];
    }
    if (linked) {
      linked.variants.push(hit.text);
      lookup.set(key, linked);
      continue;
    }
    const label = prefix(hit.type);
    const assigned = used.get(label) ?? new Set<number>();
    let number = 1;
    if (hit.type === "email") {
      const local = normalized(hit.text.split("@")[0]!);
      const people = entries.filter(
        (entry) =>
          entry.type === "person" &&
          (normalized(entry.value) === local ||
            entry.value.split(/\s+/).some((part) => normalized(part) === local)),
      );
      if (people.length === 1) {
        number = Number(people[0]!.placeholder.split("_")[1]);
        const existing = entries.find((entry) => entry.placeholder === `EMAIL_${number}`);
        if (existing) {
          existing.variants.push(hit.text);
          lookup.set(key, existing);
          continue;
        }
      } else {
        const reserved = new Set(
          entries
            .filter((entry) => entry.type === "person")
            .map((entry) => Number(entry.placeholder.split("_")[1])),
        );
        while (assigned.has(number) || reserved.has(number)) number++;
      }
    }
    while (assigned.has(number)) number++;
    assigned.add(number);
    used.set(label, assigned);
    const entry = {
      placeholder: `${label}_${number}`,
      type: hit.type,
      value: hit.text,
      variants: [],
    };
    entries.push(entry);
    lookup.set(key, entry);
  }
  return { entries, lookup };
}

export function scrub(
  docs: TextDocument[],
  detections: Detection[],
  decisions: RedactionDecision[] = [],
): ScrubResult {
  const documents = new Map(docs.map((doc) => [doc.docKey, doc.text]));
  if (documents.size !== docs.length) throw new Error("Duplicate document keys");
  const actions = new Map(decisions.map((decision) => [decision.detectionId, decision.action]));
  const ids = new Set(detections.map((hit) => hit.id));
  if (
    ids.size !== detections.length ||
    actions.size !== decisions.length ||
    decisions.some((decision) => !ids.has(decision.detectionId))
  )
    throw new Error("Invalid redaction decisions");
  for (const hit of detections) {
    const text = documents.get(hit.docKey);
    if (
      text === undefined ||
      !Number.isInteger(hit.start) ||
      !Number.isInteger(hit.end) ||
      hit.start < 0 ||
      hit.end <= hit.start ||
      hit.end > text.length ||
      text.slice(hit.start, hit.end) !== hit.text
    )
      throw new Error("Invalid detection offsets");
  }
  const action = (hit: Detection): RedactionDecision["action"] =>
    hit.source === "self" ? "redact" : (actions.get(hit.id) ?? "pseudonymise");
  const registry = buildRegistry(detections.filter((hit) => action(hit) === "pseudonymise"));
  const expanded = [...detections];
  const aliases = new Map<string, PseudonymEntry[]>();
  for (const entry of registry.entries.filter(
    (entry) => entry.type === "person" && entry.value.includes(" "),
  ))
    for (const token of entry.value.split(/\s+/).filter((part) => part.length >= 3)) {
      const key = token.toLowerCase();
      aliases.set(key, [...(aliases.get(key) ?? []), entry]);
    }
  for (const [alias, entries] of aliases)
    if (entries.length === 1)
      for (const doc of docs)
        for (const match of doc.text.matchAll(termPattern(alias))) {
          if (
            detections.some(
              (hit) =>
                hit.docKey === doc.docKey &&
                match.index < hit.end &&
                match.index + match[0].length > hit.start,
            )
          )
            continue;
          const entry = entries[0]!;
          if (!entry.variants.includes(match[0])) entry.variants.push(match[0]);
          registry.lookup.set(identity("person", match[0]), entry);
          expanded.push({
            id: `linked-${expanded.length}`,
            docKey: doc.docKey,
            type: "person",
            text: match[0],
            start: match.index,
            end: match.index + match[0].length,
            source: "ner",
            confidence: 0.8,
          });
        }
  const result: ScrubResult = {
    documents: [],
    pseudonymMap: [],
    selfRedactionCount: 0,
    counts: {},
    appliedDetections: 0,
  };
  const used = new Set<string>();
  for (const doc of docs) {
    let cursor = 0;
    let text = "";
    for (const hit of resolveOverlaps(
      expanded.filter((candidate) => candidate.docKey === doc.docKey),
    )) {
      const selected = action(hit);
      if (selected === "keep") continue;
      let replacement = "[REDACTED]";
      if (selected === "pseudonymise") {
        const entry = registry.lookup.get(identity(hit.type, hit.text))!;
        replacement = entry.placeholder;
        used.add(replacement);
        if (hit.text !== entry.value && !entry.variants.includes(hit.text))
          entry.variants.push(hit.text);
      }
      text += doc.text.slice(cursor, hit.start) + replacement;
      cursor = hit.end;
      result.appliedDetections++;
      const countKey = hit.source === "self" ? "self" : hit.type;
      result.counts[countKey] = (result.counts[countKey] ?? 0) + 1;
      if (hit.source === "self") result.selfRedactionCount++;
    }
    result.documents.push({ docKey: doc.docKey, text: text + doc.text.slice(cursor) });
  }
  result.pseudonymMap = registry.entries.filter((entry) => used.has(entry.placeholder));
  return result;
}
