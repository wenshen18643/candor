import { detectPii } from "./detect.js";
import type {
  AnalysisPayload,
  EntityType,
  LeakageReport,
  ScrubResult,
  StrippedFile,
} from "./types.js";

const quasiRules = [
  {
    kind: "unique_role",
    pattern:
      /\b(?:as\s+)?(?:I am|I was|the only|I'm)\s+[^.!?\n]{1,80}(?:nurse|engineer|manager|shift|team|department|officer|director)\b/gi,
  },
  {
    kind: "small_headcount",
    pattern:
      /\b(?:only\s+)?(?:[1-9]|one|two|three|four|five|six|seven|eight|nine)\s+(?:people|employees|staff|members|nurses|engineers)\b/gi,
  },
  {
    kind: "team_role",
    pattern:
      /\b(?:manager|director|lead|engineer|nurse|officer)\s+(?:of|for|on|in)\s+(?:the\s+)?[^.!?\n]{1,40}?\b(?:team|department|unit|shift)\b/gi,
  },
  {
    kind: "exact_timestamp",
    pattern:
      /\b(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?|\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)\b/gi,
  },
  {
    kind: "specific_location",
    pattern:
      /\b(?:remote|rural|small|only)\s+[\p{L} -]{1,30}\b(?:village|outpost|clinic|branch|office)\b/giu,
  },
];

export function assessLeakage(result: ScrubResult, selfTerms: string[]): LeakageReport {
  const detections = detectPii(result.documents, { selfTerms });
  const residual: LeakageReport["residual"] = detections.map((hit) => ({
    docKey: hit.docKey,
    type: hit.source === "self" ? "self" : hit.type,
    text: hit.text,
  }));
  const quasiIdentifiers: LeakageReport["quasiIdentifiers"] = [];
  for (const doc of result.documents)
    for (const rule of quasiRules)
      for (const match of doc.text.matchAll(rule.pattern))
        quasiIdentifiers.push({ docKey: doc.docKey, kind: rule.kind, text: match[0] });
  const weights: Record<string, number> = {
    self: 40,
    email: 25,
    phone: 25,
    person: 15,
    id: 25,
    account: 25,
    ip: 25,
    date_of_birth: 25,
    url: 10,
    org: 5,
    place: 5,
    other: 5,
  };
  const score = Math.min(
    100,
    residual.reduce((sum, hit) => sum + (weights[hit.type] ?? 5), 0) + quasiIdentifiers.length * 5,
  );
  const notes: string[] = [];
  if (residual.some((hit) => hit.type === "self"))
    notes.push("Reporter identifiers remain and pose the greatest identification risk.");
  if (residual.some((hit) => ["email", "phone", "account", "id"].includes(hit.type)))
    notes.push("Contact or account identifiers remain in the analysis text.");
  if (residual.some((hit) => hit.type === "person"))
    notes.push("Names remain in the analysis text.");
  if (quasiIdentifiers.length)
    notes.push(
      "Specific roles, small groups, locations or exact times may identify a source when combined.",
    );
  if (!score)
    notes.push(
      "No identifiers were detected by these checks; review the text for contextual clues.",
    );
  return {
    score,
    level: score < 15 ? "low" : score < 40 ? "elevated" : "high",
    residual,
    quasiIdentifiers,
    notes,
  };
}

export function buildAnalysisPayload(args: {
  reportId: string;
  campaignId: string;
  statementKey: string;
  files: StrippedFile[];
  scrub: ScrubResult;
}): AnalysisPayload {
  const documents = new Map(args.scrub.documents.map((doc) => [doc.docKey, doc.text]));
  if (documents.size !== args.scrub.documents.length || !documents.has(args.statementKey))
    throw new Error("Missing or duplicate scrubbed document");
  const payload: AnalysisPayload = {
    version: 1,
    report_id: args.reportId,
    campaign_id: args.campaignId,
    language: "en",
    reporter_statement: documents.get(args.statementKey)!,
    documents: [],
    entity_legend: args.scrub.pseudonymMap.map((entry) => ({
      placeholder: entry.placeholder,
      type:
        entry.type === "ip" || entry.type === "date_of_birth"
          ? "other"
          : (entry.type as EntityType),
    })),
    redaction_summary: { ...args.scrub.counts },
  };
  const names = new Set<string>();
  for (const [index, file] of args.files.entries()) {
    if (file.kind === "image" || file.kind === "unsupported") continue;
    if (names.has(file.name) || file.name === args.statementKey)
      throw new Error("Duplicate file key");
    names.add(file.name);
    const text = documents.get(file.name) ?? documents.get(`D${index + 1}`);
    if (text === undefined) throw new Error("Missing scrubbed file text");
    if (
      file.anchorDate !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(file.anchorDate) ||
        !Number.isFinite(Date.parse(file.anchorDate)) ||
        new Date(file.anchorDate).toISOString().slice(0, 10) !== file.anchorDate)
    )
      throw new Error("Invalid anchor date");
    payload.documents.push({
      doc_id: `D${payload.documents.length + 1}`,
      title: `Document ${payload.documents.length + 1}`,
      kind: file.kind,
      anchor_date: file.anchorDate,
      text,
    });
  }
  return payload;
}
