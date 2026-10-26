import type { BadgeTone } from "@/components/ui/badge";

import type { EvidenceClass, Verdict } from "./types";

export const evidenceClassMeta: Record<
  EvidenceClass,
  { label: string; tone: BadgeTone; description: string; rank: number }
> = {
  corroborated: {
    label: "Corroborated",
    tone: "documented",
    description: "Supported by two or more independent documents.",
    rank: 0,
  },
  documented: {
    label: "Documented",
    tone: "documented",
    description: "Supported verbatim by one document.",
    rank: 1,
  },
  single_source: {
    label: "Single source",
    tone: "info",
    description: "Rests on one informal or secondhand source, or is an inference.",
    rank: 2,
  },
  reporter_allegation: {
    label: "Allegation",
    tone: "allegation",
    description: "Stated by the reporter with no supporting document.",
    rank: 3,
  },
  contradicted: {
    label: "Contradicted",
    tone: "contradicted",
    description: "Conflicts with other evidence; see contradictions.",
    rank: 4,
  },
  unsupported: {
    label: "Unsupported",
    tone: "unsupported",
    description: "The cited source does not support it, or only a quarantined passage does.",
    rank: 5,
  },
};

export const verdictMeta: Record<Verdict, { label: string; tone: BadgeTone }> = {
  supported: { label: "Supported", tone: "documented" },
  partially_supported: { label: "Partly supported", tone: "info" },
  not_supported: { label: "Not supported", tone: "unsupported" },
  contradicted: { label: "Contradicted", tone: "contradicted" },
  unverifiable: { label: "Unverifiable", tone: "allegation" },
};

export const confidenceLabel: Record<string, string> = {
  high: "High confidence",
  moderate: "Moderate confidence",
  low: "Low confidence",
  very_low: "Very low confidence",
};

export const stageMeta: Record<string, { label: string; kind: "llm" | "local"; blurb: string }> = {
  segment: {
    label: "Segment",
    kind: "local",
    blurb: "Split sources into passages with stable IDs and hashes.",
  },
  injection_scan: {
    label: "Injection scan",
    kind: "llm",
    blurb: "Heuristics plus a classifier quarantine passages that try to instruct the model.",
  },
  extract: {
    label: "Extract",
    kind: "llm",
    blurb: "Independent samples pull atomic claims with verbatim quotes.",
  },
  consolidate: {
    label: "Consolidate",
    kind: "local",
    blurb: "Cluster samples; agreement across samples becomes a signal.",
  },
  ground: {
    label: "Ground",
    kind: "local",
    blurb: "Every quote is matched character-for-character against its passage.",
  },
  verify: {
    label: "Verify",
    kind: "llm",
    blurb: "A separate verifier judges each claim against only its cited text.",
  },
  temporal: {
    label: "Temporal",
    kind: "local",
    blurb: "Normalise dates into intervals and solve a Simple Temporal Network.",
  },
  entities: {
    label: "Entities",
    kind: "llm",
    blurb: "Link aliases to pseudonyms with union-find; never infer real identities.",
  },
  contradictions: {
    label: "Contradictions",
    kind: "llm",
    blurb: "Blocked candidate pairs are judged for conflict and severity.",
  },
  calibrate: {
    label: "Calibrate",
    kind: "local",
    blurb: "Combine agreement, verdicts and sources into calibrated confidence.",
  },
  gaps: {
    label: "Gaps",
    kind: "llm",
    blurb: "Neutral follow-up questions target the weakest parts of the account.",
  },
  brief: {
    label: "Brief",
    kind: "llm",
    blurb: "A summary where every point cites claims, validated before release.",
  },
};

export const stageOrder = [
  "segment",
  "injection_scan",
  "extract",
  "consolidate",
  "ground",
  "verify",
  "temporal",
  "entities",
  "contradictions",
  "calibrate",
  "gaps",
  "brief",
] as const;

export const stageDependencies: Record<string, string[]> = {
  segment: [],
  injection_scan: ["segment"],
  extract: ["segment", "injection_scan"],
  consolidate: ["extract"],
  ground: ["consolidate"],
  verify: ["ground"],
  temporal: ["consolidate"],
  entities: ["consolidate"],
  contradictions: ["verify", "temporal"],
  calibrate: ["verify", "contradictions", "temporal"],
  gaps: ["calibrate", "entities", "temporal"],
  brief: ["gaps"],
};
