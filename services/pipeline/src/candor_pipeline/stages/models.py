from typing import Literal

from pydantic import Field

from candor_pipeline.contracts import (
    Citation,
    ClaimKind,
    FollowUpQuestion,
    InjectionFinding,
    Severity,
    SourceType,
    Strict,
    TemporalLink,
    Verification,
)


class RawClaim(Strict):
    claim_id: str
    statement: str
    kind: ClaimKind
    actors: list[str] = Field(default_factory=list)
    targets: list[str] = Field(default_factory=list)
    action: str
    time_expression: str | None = None
    temporal_links: list[TemporalLink] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    source_type: SourceType


class Extraction(Strict):
    claims: list[RawClaim]


class InjectionOutput(Strict):
    findings: list[InjectionFinding]


class VerifiedClaim(Strict):
    claim_id: str
    verification: Verification


class VerificationOutput(Strict):
    verifications: list[VerifiedClaim]


class AliasLink(Strict):
    alias: str
    placeholder: str
    passage_id: str
    quote: str
    roles: list[str] = Field(default_factory=list)


class EntitiesOutput(Strict):
    aliases: list[AliasLink]


class PairJudgment(Strict):
    claim_ids: list[str] = Field(min_length=2, max_length=2)
    label: Literal["contradiction", "compatible", "unrelated"]
    description: str
    severity: Severity
    passages: list[str]


class ContradictionsOutput(Strict):
    pairs: list[PairJudgment]


class GapsOutput(Strict):
    questions: list[FollowUpQuestion]
