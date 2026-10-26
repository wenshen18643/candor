import asyncio
import importlib
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

from candor_pipeline.config import PipelineConfig
from candor_pipeline.contracts import (
    AnalysisMetrics,
    AnalysisPayload,
    AnalysisResult,
    DocumentRef,
    EventStatus,
    StageEvent,
    StageName,
    StageRun,
)
from candor_pipeline.providers.base import LLMProvider, ProviderError
from candor_pipeline.router import Router
from candor_pipeline.stages.context import CallStats, PipelineContext, StageOutput

DEPENDENCIES: dict[StageName, tuple[StageName, ...]] = {
    "segment": (),
    "injection_scan": ("segment",),
    "extract": ("segment", "injection_scan"),
    "consolidate": ("extract",),
    "ground": ("consolidate",),
    "verify": ("ground",),
    "temporal": ("consolidate",),
    "entities": ("consolidate",),
    "contradictions": ("verify", "temporal"),
    "calibrate": ("verify", "contradictions", "temporal"),
    "gaps": ("calibrate", "entities", "temporal"),
    "brief": (
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
    ),
}
NONCRITICAL = {"entities", "contradictions", "gaps", "brief"}
EventCallback = Callable[[StageEvent], Awaitable[None]]
StageFunction = Callable[[PipelineContext], Awaitable[StageOutput]]


def failure_code(error: Exception) -> str:
    if isinstance(error, ProviderError):
        return str(error)
    return type(error).__name__


class PipelineError(Exception):
    def __init__(self, stage: str, retryable: bool = False) -> None:
        super().__init__("pipeline_stage_failed:" + stage)
        self.stage = stage
        self.retryable = retryable


def metrics(ctx: PipelineContext, stages: list[StageRun], duration_ms: int) -> AnalysisMetrics:
    citations = [cite for claim in ctx.claims for cite in claim.citations]
    return AnalysisMetrics(
        claims_total=len(ctx.claims),
        claims_supported=sum(
            claim.verification is not None and claim.verification.verdict == "supported"
            for claim in ctx.claims
        ),
        claims_unsupported=sum(claim.evidence_class == "unsupported" for claim in ctx.claims),
        citations_total=len(citations),
        citations_verified=sum(cite.quote_verified for cite in citations),
        mean_confidence=sum(claim.confidence.score for claim in ctx.claims if claim.confidence)
        / max(1, len(ctx.claims)),
        temporal_conflicts=len(ctx.temporal_conflicts),
        contradictions=len(ctx.contradictions),
        injection_passages=len(ctx.injection_findings),
        total_cost_usd=sum(stage.cost_usd for stage in stages),
        total_duration_ms=duration_ms,
    )


class DAGRunner:
    def __init__(
        self,
        provider: LLMProvider | None = None,
        config: PipelineConfig | None = None,
        router: Router | None = None,
    ) -> None:
        self.config = config or PipelineConfig()
        default_router = Path(__file__).parents[2] / "router.json"
        if router is not None:
            self.router = router
        elif not self.config.router and provider is None and default_router.is_file():
            self.router = Router.from_file(default_router)
        else:
            self.router = Router(provider, self.config.router)

    async def run(
        self,
        payload: AnalysisPayload,
        callback: EventCallback | None = None,
        job_id: str | None = None,
        nonce: str | None = None,
    ) -> AnalysisResult:
        ctx = PipelineContext(payload, self.router, self.config)
        if nonce is not None:
            if not nonce.isalnum() or len(nonce) < 16:
                raise ValueError("invalid_spotlight_nonce")
            ctx.nonce = nonce
        started = time.monotonic()
        semaphore = asyncio.Semaphore(self.config.concurrency)
        runs: dict[str, StageRun] = {}
        tasks: dict[str, asyncio.Task[None]] = {}

        async def emit(stage: StageName, status: EventStatus) -> None:
            if callback:
                stats = ctx.stats.get(stage, CallStats())
                response = stats.responses[-1] if stats.responses else None
                await callback(
                    StageEvent(
                        job_id=job_id or payload.report_id,
                        stage=stage,
                        status=status,
                        at=datetime.now(UTC),
                        provider=response.provider if response else None,
                        model=response.model if response else None,
                    )
                )

        async def execute(stage: StageName) -> None:
            for dependency in DEPENDENCIES[stage]:
                await tasks[dependency]
            async with semaphore:
                await emit(stage, "started")
                began = datetime.now(UTC)
                timer = time.monotonic()
                status: EventStatus = "succeeded"
                notes: list[str] = []
                failure: Exception | None = None
                function = cast(
                    StageFunction, importlib.import_module("candor_pipeline.stages." + stage).run
                )
                attempt = 0
                for attempt in range(self.config.retries + 1):
                    try:
                        output = await function(ctx)
                        stats = ctx.stats.get(stage, CallStats())
                        if output.degraded or stats.degraded:
                            status = "degraded"
                        notes = output.notes
                        break
                    except Exception as error:
                        retryable = isinstance(error, ProviderError) and error.retryable
                        if retryable and attempt < self.config.retries:
                            await asyncio.sleep(0.5 * 2**attempt)
                            continue
                        status = "degraded" if stage in NONCRITICAL else "failed"
                        notes = ["stage_unavailable", failure_code(error)]
                        failure = error
                        break
                stats = ctx.stats.get(stage, CallStats())
                providers = sorted({response.provider for response in stats.responses})
                models = sorted({response.model for response in stats.responses})
                runs[stage] = StageRun(
                    stage=stage,
                    status=status,
                    started_at=began,
                    ended_at=datetime.now(UTC),
                    duration_ms=int((time.monotonic() - timer) * 1000),
                    provider=",".join(providers),
                    model=",".join(models),
                    attempts=attempt + 1,
                    repairs=stats.repairs,
                    llm_calls=len(stats.responses),
                    input_tokens=sum(response.usage.input_tokens for response in stats.responses),
                    output_tokens=sum(response.usage.output_tokens for response in stats.responses),
                    cost_usd=sum(response.usage.cost_usd for response in stats.responses),
                    notes=notes,
                )
                await emit(stage, status)
                if status == "failed":
                    raise PipelineError(
                        stage, isinstance(failure, ProviderError) and failure.retryable
                    ) from None

        for stage in DEPENDENCIES:
            tasks[stage] = asyncio.create_task(execute(stage), name="candor:" + stage)
        try:
            await asyncio.gather(*tasks.values())
        finally:
            for task in tasks.values():
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks.values(), return_exceptions=True)
        stages = [runs[stage] for stage in DEPENDENCIES]
        return AnalysisResult(
            report_id=payload.report_id,
            generated_at=datetime.now(UTC),
            documents=[
                DocumentRef(
                    doc_id=document.doc_id,
                    title=document.title,
                    kind=document.kind,
                    anchor_date=document.anchor_date,
                )
                for document in payload.documents
            ],
            summary=ctx.summary,
            passages=ctx.passages,
            claims=ctx.claims,
            timeline=ctx.timeline,
            temporal_conflicts=ctx.temporal_conflicts,
            entities=ctx.entities,
            relations=ctx.relations,
            contradictions=ctx.contradictions,
            follow_up_questions=ctx.questions,
            injection_findings=ctx.injection_findings,
            stages=stages,
            metrics=metrics(ctx, stages, int((time.monotonic() - started) * 1000)),
            router={
                stage.stage: f"{stage.provider}:{stage.model}" for stage in stages if stage.provider
            },
        )


async def run_pipeline(
    payload: AnalysisPayload,
    provider: LLMProvider | None = None,
    config: PipelineConfig | None = None,
    callback: EventCallback | None = None,
) -> AnalysisResult:
    return await DAGRunner(provider, config).run(payload, callback)
