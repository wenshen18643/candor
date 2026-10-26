import asyncio
import json
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from candor_pipeline.config import PipelineConfig
from candor_pipeline.contracts import (
    AnalysisPayload,
    BriefSummary,
    Claim,
    Contradiction,
    Entity,
    FollowUpQuestion,
    InjectionFinding,
    Passage,
    Relation,
    StageName,
    TemporalConflict,
    TimelineEvent,
)
from candor_pipeline.prompts import system_prompt, user_prompt
from candor_pipeline.providers.base import LLMRequest, LLMResponse
from candor_pipeline.router import Router
from candor_pipeline.stages.models import RawClaim
from candor_pipeline.structured import complete_structured, strict_schema, validate_references


@dataclass
class StageOutput:
    degraded: bool = False
    notes: list[str] = field(default_factory=list)


@dataclass
class CallStats:
    repairs: int = 0
    degraded: bool = False
    responses: list[LLMResponse] = field(default_factory=list)


@dataclass
class PipelineContext:
    payload: AnalysisPayload
    router: Router
    config: PipelineConfig = field(default_factory=PipelineConfig)
    nonce: str = field(default_factory=lambda: secrets.token_hex(16))
    passages: list[Passage] = field(default_factory=list)
    samples: list[list[RawClaim]] = field(default_factory=list)
    claims: list[Claim] = field(default_factory=list)
    agreements: dict[str, float] = field(default_factory=dict)
    time_expressions: dict[str, str | None] = field(default_factory=dict)
    timeline: list[TimelineEvent] = field(default_factory=list)
    temporal_conflicts: list[TemporalConflict] = field(default_factory=list)
    entities: list[Entity] = field(default_factory=list)
    relations: list[Relation] = field(default_factory=list)
    contradictions: list[Contradiction] = field(default_factory=list)
    questions: list[FollowUpQuestion] = field(default_factory=list)
    injection_findings: list[InjectionFinding] = field(default_factory=list)
    summary: BriefSummary = field(
        default_factory=lambda: BriefSummary(
            headline="Evidence review",
            overview="Review requires human assessment.",
            key_points=[],
            limitations=["Automated summary unavailable."],
        )
    )
    stats: dict[str, CallStats] = field(default_factory=dict)
    llm_semaphore: asyncio.Semaphore = field(init=False)

    def __post_init__(self) -> None:
        self.llm_semaphore = asyncio.Semaphore(self.config.concurrency)

    async def ask[T: BaseModel](
        self,
        stage: StageName,
        model: type[T],
        passages: list[Passage] | None = None,
        context: Any = None,
        sample: int = 0,
        semantic: Callable[[T], None] | None = None,
    ) -> T | None:
        selected = self.passages if passages is None else passages
        schema = strict_schema(model)
        request = LLMRequest(
            stage=stage,
            system=system_prompt(stage),
            user=user_prompt(selected, self.nonce, context)
            + "\nOUTPUT SCHEMA\n"
            + json.dumps(schema, sort_keys=True, separators=(",", ":")),
            schema_name=model.__name__,
            json_schema=schema,
            sample_index=sample,
            temperature=self.config.temperatures[sample > 0] if stage == "extract" else 0,
            max_tokens=self.config.max_tokens,
        )
        passage_ids = {passage.passage_id for passage in selected}
        claim_ids = {claim.claim_id for claim in self.claims} if stage != "extract" else None

        def validate(value: T) -> None:
            validate_references(value.model_dump(), passage_ids, claim_ids)
            if semantic:
                semantic(value)

        async with self.llm_semaphore:
            result = await complete_structured(
                self.router.for_stage(stage), request, model, validate, self.config.repairs
            )
        stats = self.stats.setdefault(stage, CallStats())
        stats.repairs += result.repairs
        stats.degraded |= result.degraded
        stats.responses.extend(result.responses)
        return result.value
