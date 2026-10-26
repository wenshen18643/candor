export type {
  AnalysisMetrics,
  AnalysisPayload,
  AnalysisResult,
  BriefSummary,
  Citation,
  Claim,
  Confidence,
  Contradiction,
  DocumentRef,
  Entity,
  FollowUpQuestion,
  InjectionFinding,
  Passage,
  Relation1 as Relation,
  StageEvent,
  StageRun,
  TemporalConflict,
  TimeInterval,
  TimelineEvent,
  Verification,
} from "./contracts.generated";

export type EvidenceClass =
  | "documented"
  | "corroborated"
  | "single_source"
  | "reporter_allegation"
  | "unsupported"
  | "contradicted";

export type Verdict =
  "supported" | "partially_supported" | "not_supported" | "contradicted" | "unverifiable";

export type StageName =
  | "segment"
  | "injection_scan"
  | "extract"
  | "consolidate"
  | "ground"
  | "verify"
  | "temporal"
  | "entities"
  | "contradictions"
  | "calibrate"
  | "gaps"
  | "brief";

export type PseudonymEntry = {
  placeholder: string;
  type: string;
  value: string;
  variants: string[];
};
