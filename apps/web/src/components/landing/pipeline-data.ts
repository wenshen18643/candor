import showcaseAnalysis from "@/data/showcase-analysis.json";
import { stageMeta, stageOrder } from "@/lib/evidence";
import type { AnalysisResult, EvidenceClass, StageName, Verdict } from "@/lib/types";

export const analysis = showcaseAnalysis as unknown as AnalysisResult;

export const stageDetail: Record<StageName, { calls: string; algorithm: string }> = {
  segment: {
    calls: "Code",
    algorithm:
      "Splits each document and the reporter's statement into 300 to 900 character passages at paragraph and sentence boundaries, never mid-sentence. Each passage gets a stable ID such as D2.P001, character offsets and a SHA-256 hash, so every later citation points at exact text.",
  },
  injection_scan: {
    calls: "Regex families + 1 call",
    algorithm:
      "Six heuristic families (instruction overrides, role switching, system-prompt references, output manipulation, tool or URL exfiltration, hidden-text markers) score every passage. One batched classifier call refines the risky ones; anything scoring 0.7 or more is quarantined.",
  },
  extract: {
    calls: "3 independent samples",
    algorithm:
      "Three samples (temperature 0.2, then 0.8) extract atomic claims: who did what to whom and when, each with verbatim quotes of at most 40 words and the passage they come from. IDs stay sample-local until consolidation.",
  },
  consolidate: {
    calls: "Code",
    algorithm:
      "Claims are clustered across samples with similarity 0.6 × token-set ratio + 0.2 × actor Jaccard + 0.2 × citation overlap, merging at 0.72; claims from one sample never merge. The medoid becomes the claim, and the share of samples in its cluster becomes its sample agreement.",
  },
  ground: {
    calls: "Code",
    algorithm:
      "Each quote is normalised (whitespace, quote marks, dashes) and searched for as an exact substring of its cited passage, with a fuzzy partial ratio of 95 as the only fallback. Citations to passages that do not exist are dropped; a claim with no verified quote is flagged.",
  },
  verify: {
    calls: "Batched, 20 claims per call",
    algorithm:
      "A separate verifier prompt at temperature 0 judges each claim against only the text of its cited passages: supported, partly supported, not supported, contradicted or unverifiable, with a one-sentence rationale.",
  },
  temporal: {
    calls: "Code + constraint solver",
    algorithm:
      "Time expressions become day intervals anchored to each document's date, including “early March” and “two weeks later”. Intervals and links such as “after the audit” form a Simple Temporal Network; a negative cycle means the dates cannot all be true, so the cycle is reported with its passages, its weakest constraint is dropped, and Floyd–Warshall computes the tightened bounds.",
  },
  entities: {
    calls: "1 call + union-find",
    algorithm:
      "One call proposes alias links such as “the CFO” → PERSON_4, each with the passage that justifies it. Links merge with union-find, and two different placeholders are never merged unless a passage explicitly equates them.",
  },
  contradictions: {
    calls: "Blocking + 1 call",
    algorithm:
      "Candidate pairs are limited to claims that share an actor or target and overlap in time or polarity, capped at 60. One batched call labels each pair contradiction, compatible or unrelated, with a severity; temporal conflicts are added too.",
  },
  calibrate: {
    calls: "Code",
    algorithm:
      "Confidence is σ(−1.6 + 2.2·agreement + 1.8·verdict + 0.45·min(sources, 3) − 1.2·contradicted − 1.5·injected). The evidence class follows fixed rules: corroborated needs two independent documents, documented one, and an allegation is anything stated without document support.",
  },
  gaps: {
    calls: "1 call",
    algorithm:
      "The weakest parts of the account (low confidence, unknown dates, unresolved actors, unsupported allegations) become 3 to 8 neutral, non-leading questions for the reporter. Questions may never ask about the reporter's own identity, role or contact details.",
  },
  brief: {
    calls: "1 call + validation",
    algorithm:
      "The summary is written from calibrated claims only, and every key point must end with references such as [C004, C007]. Code then drops any point that cites a missing claim or rests only on unsupported ones.",
  },
};

export type StageStat = { durationMs: number; llmCalls: number; repairs: number; notes: string[] };

export function stageStats(): Record<string, StageStat> {
  return Object.fromEntries(
    analysis.stages.map((run) => [
      run.stage,
      {
        durationMs: run.duration_ms,
        llmCalls: run.llm_calls,
        repairs: run.repairs,
        notes: run.notes,
      },
    ]),
  );
}

export const showcaseTotals = {
  stages: stageOrder.length,
  modelStages: stageOrder.filter((stage) => stageMeta[stage]?.kind === "llm").length,
  durationMs: analysis.metrics.total_duration_ms,
  claims: analysis.metrics.claims_total,
  citations: analysis.metrics.citations_total,
};

const verdictWeight: Record<Verdict, number> = {
  supported: 1,
  partially_supported: 0.6,
  unverifiable: 0,
  not_supported: -0.6,
  contradicted: -1.2,
};

const docLabels: Record<string, string> = {
  D1: "Email, 18 Feb",
  D2: "Email, 5 Mar",
  D3: "Chat export, 6 Mar",
  D4: "Committee minutes",
  D5: "Payments ledger",
  D6: "Vendor proposal",
  S: "Reporter statement",
};

function normalise(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

export type TraceCitation = {
  passageId: string;
  docLabel: string;
  text: string;
  quote: string;
  start: number;
  end: number;
  exact: boolean;
};

export type ClaimTrace = {
  claimId: string;
  statement: string;
  samples: number;
  agreeing: number;
  citations: TraceCitation[];
  verdict: Verdict;
  rationale: string;
  checked: string[];
  agreement: number;
  verdictWeight: number;
  sources: number;
  contradicted: boolean;
  injected: boolean;
  logit: number;
  score: number;
  label: "high" | "moderate" | "low" | "very_low";
  evidenceClass: EvidenceClass;
  confidenceStatement: string;
};

export function buildTrace(claimId: string): ClaimTrace | null {
  const claim = analysis.claims.find((item) => item.claim_id === claimId);
  if (!claim || !claim.verification || !claim.confidence) return null;
  const passages = new Map(analysis.passages.map((passage) => [passage.passage_id, passage]));
  const citations = claim.citations.flatMap((citation) => {
    const passage = passages.get(citation.passage_id);
    if (!passage) return [];
    const exactAt = passage.text.indexOf(citation.quote);
    const start =
      exactAt >= 0 ? exactAt : normalise(passage.text).indexOf(normalise(citation.quote));
    if (start < 0) return [];
    return [
      {
        passageId: passage.passage_id,
        docLabel: docLabels[passage.doc_id] ?? passage.doc_id,
        text: passage.text,
        quote: citation.quote,
        start,
        end: start + citation.quote.length,
        exact: exactAt >= 0,
      },
    ];
  });
  const verdict = claim.verification.verdict as Verdict;
  const agreement = claim.confidence.sample_agreement;
  const sources = new Set(
    citations
      .map((citation) => passages.get(citation.passageId)?.doc_id)
      .filter((doc): doc is string => Boolean(doc) && doc !== "S"),
  ).size;
  const contradicted = analysis.contradictions.some(
    (item) => item.severity !== "low" && item.claim_ids.includes(claim.claim_id),
  );
  const injected = (claim.flags as string[]).includes("cites_injected_passage");
  const weight = verdictWeight[verdict];
  const logit =
    -1.6 +
    2.2 * agreement +
    1.8 * weight +
    0.45 * Math.min(sources, 3) -
    1.2 * Number(contradicted) -
    1.5 * Number(injected);
  const score = 1 / (1 + Math.exp(-logit));
  const label =
    score >= 0.8 ? "high" : score >= 0.6 ? "moderate" : score >= 0.35 ? "low" : "very_low";
  const samples = 3;
  const agreeing = Math.round(agreement * samples);
  const granularity = claim.time?.granularity;
  const precision =
    granularity === "day"
      ? "date known to the day"
      : granularity
        ? `date precision: ${granularity}`
        : "date unresolved";
  return {
    claimId: claim.claim_id,
    statement: claim.statement,
    samples,
    agreeing,
    citations,
    verdict,
    rationale: claim.verification.rationale,
    checked: claim.verification.checked_passages,
    agreement,
    verdictWeight: weight,
    sources,
    contradicted,
    injected,
    logit,
    score,
    label,
    evidenceClass: claim.evidence_class as EvidenceClass,
    confidenceStatement: `Supported by ${sources} documents; ${agreeing}/${samples} extraction samples agree; ${precision}.`,
  };
}

export const quarantinedPassage = (() => {
  const finding = analysis.injection_findings[0];
  const passage = analysis.passages.find((item) => item.passage_id === finding?.passage_id);
  return finding && passage
    ? { id: passage.passage_id, text: passage.text, risk: finding.risk, signals: finding.signals }
    : null;
})();

export const timelineSummary = {
  events: analysis.timeline.length,
  exact: analysis.timeline.filter((event) => event.interval.granularity === "day").length,
  conflicts: analysis.temporal_conflicts.length,
};

export const temporalConflict = analysis.temporal_conflicts[0] ?? null;
