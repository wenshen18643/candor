from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DocumentKind = Literal["email", "chat", "memo", "pdf", "docx", "csv", "text", "statement"]
EntityType = Literal["person", "org", "place", "email", "phone", "id", "account", "url", "other"]
Granularity = Literal["day", "week", "month", "quarter", "year", "unknown"]
ClaimKind = Literal["event", "state", "allegation", "inference"]
SourceType = Literal["document", "reporter_statement", "mixed"]
Verdict = Literal[
    "supported", "partially_supported", "not_supported", "contradicted", "unverifiable"
]
EvidenceClass = Literal[
    "documented",
    "corroborated",
    "single_source",
    "reporter_allegation",
    "unsupported",
    "contradicted",
]
ConfidenceLabel = Literal["high", "moderate", "low", "very_low"]
GapType = Literal["who", "what", "when", "where", "how", "evidence", "corroboration"]
Severity = Literal["low", "medium", "high"]
StageName = Literal[
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
]
StageStatus = Literal["succeeded", "degraded", "failed", "skipped"]
EventStatus = Literal["started", "progress", "succeeded", "degraded", "failed"]
TemporalRelation = Literal["before", "after", "during", "same_time"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=False)


class DocumentIn(Strict):
    doc_id: str = Field(pattern=r"^D\d+$")
    title: str
    kind: DocumentKind
    anchor_date: date | None = None
    text: str


class EntityLegendItem(Strict):
    placeholder: str = Field(pattern=r"^[A-Z]+_\d+$")
    type: EntityType


class AnalysisPayload(Strict):
    version: Literal[1] = 1
    report_id: str
    campaign_id: str
    language: str = "en"
    reporter_statement: str
    documents: list[DocumentIn]
    entity_legend: list[EntityLegendItem] = Field(default_factory=list)
    redaction_summary: dict[str, int] = Field(default_factory=dict)


class Passage(Strict):
    passage_id: str = Field(pattern=r"^(D\d+|S)\.P\d{3,}$")
    doc_id: str
    ordinal: int
    text: str
    char_start: int
    char_end: int
    sha256: str
    injection_risk: float = 0.0
    injection_signals: list[str] = Field(default_factory=list)


class Citation(Strict):
    passage_id: str
    quote: str
    quote_verified: bool = False
    match_start: int | None = None
    match_end: int | None = None


class TimeInterval(Strict):
    earliest: date
    latest: date
    granularity: Granularity
    source_text: str
    anchor: str | None = None


class TemporalLink(Strict):
    relation: TemporalRelation
    other_claim_id: str
    evidence_passage_id: str | None = None


class Verification(Strict):
    verdict: Verdict
    rationale: str
    checked_passages: list[str] = Field(default_factory=list)
    verifier_model: str = ""


class Confidence(Strict):
    score: float = Field(ge=0.0, le=1.0)
    sample_agreement: float = Field(ge=0.0, le=1.0)
    independent_sources: int = Field(ge=0)
    label: ConfidenceLabel
    statement: str


class Claim(Strict):
    claim_id: str = Field(pattern=r"^C\d{3,}$")
    statement: str
    kind: ClaimKind
    actors: list[str] = Field(default_factory=list)
    targets: list[str] = Field(default_factory=list)
    action: str
    time: TimeInterval | None = None
    temporal_links: list[TemporalLink] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    source_type: SourceType
    verification: Verification | None = None
    confidence: Confidence | None = None
    evidence_class: EvidenceClass | None = None
    flags: list[str] = Field(default_factory=list)


class TimelineEvent(Strict):
    event_id: str = Field(pattern=r"^T\d{3,}$")
    claim_ids: list[str]
    title: str
    interval: TimeInterval
    original_interval: TimeInterval | None = None
    order_rank: int
    constraints: list[str] = Field(default_factory=list)


class TemporalConflict(Strict):
    conflict_id: str
    event_ids: list[str]
    description: str
    constraints: list[str]
    passages: list[str] = Field(default_factory=list)


class Entity(Strict):
    entity_id: str
    placeholder: str
    type: EntityType
    aliases: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    mention_count: int = 0


class Relation(Strict):
    source: str
    target: str
    label: str
    claim_ids: list[str] = Field(default_factory=list)


class Contradiction(Strict):
    contradiction_id: str
    claim_ids: list[str] = Field(min_length=2)
    description: str
    severity: Severity
    passages: list[str] = Field(default_factory=list)


class FollowUpQuestion(Strict):
    question_id: str
    question: str
    rationale: str
    gap_type: GapType
    related_claim_ids: list[str] = Field(default_factory=list)
    priority: int = Field(ge=1, le=5)
    expected_information_gain: float = Field(ge=0.0, le=1.0)


class InjectionFinding(Strict):
    passage_id: str
    signals: list[str]
    risk: float = Field(ge=0.0, le=1.0)
    quarantined: bool


class StageRun(Strict):
    stage: StageName
    status: StageStatus
    provider: str = ""
    model: str = ""
    started_at: datetime
    ended_at: datetime
    duration_ms: int
    attempts: int = 1
    repairs: int = 0
    llm_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    notes: list[str] = Field(default_factory=list)


class BriefSummary(Strict):
    headline: str
    overview: str
    key_points: list[str]
    risk_notes: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class AnalysisMetrics(Strict):
    claims_total: int = 0
    claims_supported: int = 0
    claims_unsupported: int = 0
    citations_total: int = 0
    citations_verified: int = 0
    mean_confidence: float = 0.0
    temporal_conflicts: int = 0
    contradictions: int = 0
    injection_passages: int = 0
    total_cost_usd: float = 0.0
    total_duration_ms: int = 0


class DocumentRef(Strict):
    doc_id: str
    title: str
    kind: DocumentKind
    anchor_date: date | None = None


class AnalysisResult(Strict):
    version: Literal[1] = 1
    report_id: str
    generated_at: datetime
    summary: BriefSummary
    documents: list[DocumentRef] = Field(default_factory=list)
    passages: list[Passage]
    claims: list[Claim]
    timeline: list[TimelineEvent]
    temporal_conflicts: list[TemporalConflict] = Field(default_factory=list)
    entities: list[Entity] = Field(default_factory=list)
    relations: list[Relation] = Field(default_factory=list)
    contradictions: list[Contradiction] = Field(default_factory=list)
    follow_up_questions: list[FollowUpQuestion] = Field(default_factory=list)
    injection_findings: list[InjectionFinding] = Field(default_factory=list)
    stages: list[StageRun]
    metrics: AnalysisMetrics
    router: dict[str, str] = Field(default_factory=dict)


class StageEvent(Strict):
    job_id: str
    stage: StageName
    status: EventStatus
    at: datetime
    detail: str = ""
    progress: float | None = Field(default=None, ge=0.0, le=1.0)
    provider: str | None = None
    model: str | None = None
