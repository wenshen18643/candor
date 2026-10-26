export type ClaimsTotal = number;
export type ClaimsSupported = number;
export type ClaimsUnsupported = number;
export type CitationsTotal = number;
export type CitationsVerified = number;
export type MeanConfidence = number;
export type TemporalConflicts = number;
export type Contradictions = number;
export type InjectionPassages = number;
export type TotalCostUsd = number;
export type TotalDurationMs = number;
export type Version = 1;
export type ReportId = string;
export type CampaignId = string;
export type Language = string;
export type ReporterStatement = string;
export type DocId = string;
export type Title = string;
export type Kind = "email" | "chat" | "memo" | "pdf" | "docx" | "csv" | "text" | "statement";
export type AnchorDate = string | null;
export type Text = string;
export type Documents = DocumentIn[];
export type Placeholder = string;
export type Type =
  "person" | "org" | "place" | "email" | "phone" | "id" | "account" | "url" | "other";
export type EntityLegend = EntityLegendItem[];
export type Version1 = 1;
export type ReportId1 = string;
export type GeneratedAt = string;
export type Headline = string;
export type Overview = string;
export type KeyPoints = string[];
export type RiskNotes = string[];
export type Limitations = string[];
export type DocId1 = string;
export type Title1 = string;
export type Kind1 = "email" | "chat" | "memo" | "pdf" | "docx" | "csv" | "text" | "statement";
export type AnchorDate1 = string | null;
export type Documents1 = DocumentRef[];
export type PassageId = string;
export type DocId2 = string;
export type Ordinal = number;
export type Text1 = string;
export type CharStart = number;
export type CharEnd = number;
export type Sha256 = string;
export type InjectionRisk = number;
export type InjectionSignals = string[];
export type Passages = Passage[];
export type ClaimId = string;
export type Statement = string;
export type Kind2 = "event" | "state" | "allegation" | "inference";
export type Actors = string[];
export type Targets = string[];
export type Action = string;
export type Earliest = string;
export type Latest = string;
export type Granularity = "day" | "week" | "month" | "quarter" | "year" | "unknown";
export type SourceText = string;
export type Anchor = string | null;
export type Relation = "before" | "after" | "during" | "same_time";
export type OtherClaimId = string;
export type EvidencePassageId = string | null;
export type TemporalLinks = TemporalLink[];
export type PassageId1 = string;
export type Quote = string;
export type QuoteVerified = boolean;
export type MatchStart = number | null;
export type MatchEnd = number | null;
export type Citations = Citation[];
export type SourceType = "document" | "reporter_statement" | "mixed";
export type Verdict =
  "supported" | "partially_supported" | "not_supported" | "contradicted" | "unverifiable";
export type Rationale = string;
export type CheckedPassages = string[];
export type VerifierModel = string;
export type Score = number;
export type SampleAgreement = number;
export type IndependentSources = number;
export type Label = "high" | "moderate" | "low" | "very_low";
export type Statement1 = string;
export type EvidenceClass =
  | (
      | "documented"
      | "corroborated"
      | "single_source"
      | "reporter_allegation"
      | "unsupported"
      | "contradicted"
    )
  | null;
export type Flags = string[];
export type Claims = Claim[];
export type EventId = string;
export type ClaimIds = string[];
export type Title2 = string;
export type OrderRank = number;
export type Constraints = string[];
export type Timeline = TimelineEvent[];
export type ConflictId = string;
export type EventIds = string[];
export type Description = string;
export type Constraints1 = string[];
export type Passages1 = string[];
export type TemporalConflicts1 = TemporalConflict[];
export type EntityId = string;
export type Placeholder1 = string;
export type Type1 =
  "person" | "org" | "place" | "email" | "phone" | "id" | "account" | "url" | "other";
export type Aliases = string[];
export type Roles = string[];
export type MentionCount = number;
export type Entities = Entity[];
export type Source = string;
export type Target = string;
export type Label1 = string;
export type ClaimIds1 = string[];
export type Relations = Relation1[];
export type ContradictionId = string;
/**
 * @minItems 2
 */
export type ClaimIds2 = [string, string, ...string[]];
export type Description1 = string;
export type Severity = "low" | "medium" | "high";
export type Passages2 = string[];
export type Contradictions1 = Contradiction[];
export type QuestionId = string;
export type Question = string;
export type Rationale1 = string;
export type GapType = "who" | "what" | "when" | "where" | "how" | "evidence" | "corroboration";
export type RelatedClaimIds = string[];
export type Priority = number;
export type ExpectedInformationGain = number;
export type FollowUpQuestions = FollowUpQuestion[];
export type PassageId2 = string;
export type Signals = string[];
export type Risk = number;
export type Quarantined = boolean;
export type InjectionFindings = InjectionFinding[];
export type Stage =
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
export type Status = "succeeded" | "degraded" | "failed" | "skipped";
export type Provider = string;
export type Model = string;
export type StartedAt = string;
export type EndedAt = string;
export type DurationMs = number;
export type Attempts = number;
export type Repairs = number;
export type LlmCalls = number;
export type InputTokens = number;
export type OutputTokens = number;
export type CostUsd = number;
export type Notes = string[];
export type Stages = StageRun[];
export type JobId = string;
export type Stage1 =
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
export type Status1 = "started" | "progress" | "succeeded" | "degraded" | "failed";
export type At = string;
export type Detail = string;
export type Progress = number | null;
export type Provider1 = string | null;
export type Model1 = string | null;

export interface CandorContracts {
  AnalysisMetrics?: AnalysisMetrics;
  AnalysisPayload?: AnalysisPayload;
  AnalysisResult?: AnalysisResult;
  BriefSummary?: BriefSummary;
  Citation?: Citation;
  Claim?: Claim;
  Confidence?: Confidence;
  Contradiction?: Contradiction;
  DocumentIn?: DocumentIn;
  DocumentRef?: DocumentRef;
  Entity?: Entity;
  EntityLegendItem?: EntityLegendItem;
  FollowUpQuestion?: FollowUpQuestion;
  InjectionFinding?: InjectionFinding;
  Passage?: Passage;
  Relation?: Relation1;
  StageEvent?: StageEvent;
  StageRun?: StageRun;
  TemporalConflict?: TemporalConflict;
  TemporalLink?: TemporalLink;
  TimeInterval?: TimeInterval;
  TimelineEvent?: TimelineEvent;
  Verification?: Verification;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "AnalysisMetrics".
 */
export interface AnalysisMetrics {
  claims_total: ClaimsTotal;
  claims_supported: ClaimsSupported;
  claims_unsupported: ClaimsUnsupported;
  citations_total: CitationsTotal;
  citations_verified: CitationsVerified;
  mean_confidence: MeanConfidence;
  temporal_conflicts: TemporalConflicts;
  contradictions: Contradictions;
  injection_passages: InjectionPassages;
  total_cost_usd: TotalCostUsd;
  total_duration_ms: TotalDurationMs;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "AnalysisPayload".
 */
export interface AnalysisPayload {
  version: Version;
  report_id: ReportId;
  campaign_id: CampaignId;
  language: Language;
  reporter_statement: ReporterStatement;
  documents: Documents;
  entity_legend: EntityLegend;
  redaction_summary: RedactionSummary;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "DocumentIn".
 */
export interface DocumentIn {
  doc_id: DocId;
  title: Title;
  kind: Kind;
  anchor_date: AnchorDate;
  text: Text;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "EntityLegendItem".
 */
export interface EntityLegendItem {
  placeholder: Placeholder;
  type: Type;
}
export interface RedactionSummary {
  [k: string]: number;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "AnalysisResult".
 */
export interface AnalysisResult {
  version: Version1;
  report_id: ReportId1;
  generated_at: GeneratedAt;
  summary: BriefSummary;
  documents: Documents1;
  passages: Passages;
  claims: Claims;
  timeline: Timeline;
  temporal_conflicts: TemporalConflicts1;
  entities: Entities;
  relations: Relations;
  contradictions: Contradictions1;
  follow_up_questions: FollowUpQuestions;
  injection_findings: InjectionFindings;
  stages: Stages;
  metrics: AnalysisMetrics;
  router: Router;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "BriefSummary".
 */
export interface BriefSummary {
  headline: Headline;
  overview: Overview;
  key_points: KeyPoints;
  risk_notes: RiskNotes;
  limitations: Limitations;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "DocumentRef".
 */
export interface DocumentRef {
  doc_id: DocId1;
  title: Title1;
  kind: Kind1;
  anchor_date: AnchorDate1;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "Passage".
 */
export interface Passage {
  passage_id: PassageId;
  doc_id: DocId2;
  ordinal: Ordinal;
  text: Text1;
  char_start: CharStart;
  char_end: CharEnd;
  sha256: Sha256;
  injection_risk: InjectionRisk;
  injection_signals: InjectionSignals;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "Claim".
 */
export interface Claim {
  claim_id: ClaimId;
  statement: Statement;
  kind: Kind2;
  actors: Actors;
  targets: Targets;
  action: Action;
  time: TimeInterval | null;
  temporal_links: TemporalLinks;
  citations: Citations;
  source_type: SourceType;
  verification: Verification | null;
  confidence: Confidence | null;
  evidence_class: EvidenceClass;
  flags: Flags;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "TimeInterval".
 */
export interface TimeInterval {
  earliest: Earliest;
  latest: Latest;
  granularity: Granularity;
  source_text: SourceText;
  anchor: Anchor;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "TemporalLink".
 */
export interface TemporalLink {
  relation: Relation;
  other_claim_id: OtherClaimId;
  evidence_passage_id: EvidencePassageId;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "Citation".
 */
export interface Citation {
  passage_id: PassageId1;
  quote: Quote;
  quote_verified: QuoteVerified;
  match_start: MatchStart;
  match_end: MatchEnd;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "Verification".
 */
export interface Verification {
  verdict: Verdict;
  rationale: Rationale;
  checked_passages: CheckedPassages;
  verifier_model: VerifierModel;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "Confidence".
 */
export interface Confidence {
  score: Score;
  sample_agreement: SampleAgreement;
  independent_sources: IndependentSources;
  label: Label;
  statement: Statement1;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "TimelineEvent".
 */
export interface TimelineEvent {
  event_id: EventId;
  claim_ids: ClaimIds;
  title: Title2;
  interval: TimeInterval;
  original_interval: TimeInterval | null;
  order_rank: OrderRank;
  constraints: Constraints;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "TemporalConflict".
 */
export interface TemporalConflict {
  conflict_id: ConflictId;
  event_ids: EventIds;
  description: Description;
  constraints: Constraints1;
  passages: Passages1;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "Entity".
 */
export interface Entity {
  entity_id: EntityId;
  placeholder: Placeholder1;
  type: Type1;
  aliases: Aliases;
  roles: Roles;
  mention_count: MentionCount;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "Relation".
 */
export interface Relation1 {
  source: Source;
  target: Target;
  label: Label1;
  claim_ids: ClaimIds1;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "Contradiction".
 */
export interface Contradiction {
  contradiction_id: ContradictionId;
  claim_ids: ClaimIds2;
  description: Description1;
  severity: Severity;
  passages: Passages2;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "FollowUpQuestion".
 */
export interface FollowUpQuestion {
  question_id: QuestionId;
  question: Question;
  rationale: Rationale1;
  gap_type: GapType;
  related_claim_ids: RelatedClaimIds;
  priority: Priority;
  expected_information_gain: ExpectedInformationGain;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "InjectionFinding".
 */
export interface InjectionFinding {
  passage_id: PassageId2;
  signals: Signals;
  risk: Risk;
  quarantined: Quarantined;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "StageRun".
 */
export interface StageRun {
  stage: Stage;
  status: Status;
  provider: Provider;
  model: Model;
  started_at: StartedAt;
  ended_at: EndedAt;
  duration_ms: DurationMs;
  attempts: Attempts;
  repairs: Repairs;
  llm_calls: LlmCalls;
  input_tokens: InputTokens;
  output_tokens: OutputTokens;
  cost_usd: CostUsd;
  notes: Notes;
}
export interface Router {
  [k: string]: string;
}
/**
 * This interface was referenced by `CandorContracts`'s JSON-Schema
 * via the `definition` "StageEvent".
 */
export interface StageEvent {
  job_id: JobId;
  stage: Stage1;
  status: Status1;
  at: At;
  detail: Detail;
  progress: Progress;
  provider: Provider1;
  model: Model1;
}
