import math
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from candor_pipeline.cli import app
from candor_pipeline.config import PipelineConfig
from candor_pipeline.contracts import Contradiction, StageEvent, Verification
from candor_pipeline.dag import DAGRunner
from candor_pipeline.providers.base import LLMRequest, LLMResponse, ProviderError
from candor_pipeline.providers.replay import ReplayProvider
from candor_pipeline.router import Router
from candor_pipeline.segment import segment_payload
from candor_pipeline.stages import calibrate, consolidate, ground, temporal, verify
from candor_pipeline.stages.context import PipelineContext
from candor_pipeline.temporal.normalize import normalize_time
from tests.helpers import FIXTURE, FakeProvider, payload, raw_claim


async def test_request_concurrency_is_bounded() -> None:
    provider = FakeProvider(delay=0.001)
    await DAGRunner(provider, PipelineConfig(samples=7, concurrency=2)).run(payload())
    assert provider.maximum_active <= 2


async def test_transient_stage_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    class RetryProvider(FakeProvider):
        failed = False

        async def complete_json(self, request: LLMRequest) -> LLMResponse:
            if request.stage == "entities" and not self.failed:
                self.failed = True
                raise ProviderError("retryable_synthetic", True)
            return await super().complete_json(request)

    async def no_sleep(seconds: float) -> None:
        return None

    monkeypatch.setattr("candor_pipeline.dag.asyncio.sleep", no_sleep)
    result = await DAGRunner(RetryProvider()).run(payload())
    stage = next(item for item in result.stages if item.stage == "entities")
    assert stage.attempts == 2
    assert stage.status == "succeeded"


async def test_callback_failure_propagates_without_claim_content() -> None:
    async def callback(event: StageEvent) -> None:
        raise RuntimeError("synthetic_event_transport_failed")

    with pytest.raises(RuntimeError, match="synthetic_event_transport_failed"):
        await DAGRunner(FakeProvider()).run(payload(), callback)


async def context_with_claims(claims: list[Any]) -> PipelineContext:
    ctx = PipelineContext(payload(), Router(FakeProvider()), PipelineConfig(samples=1))
    ctx.passages = segment_payload(ctx.payload)
    ctx.samples = [claims]
    await consolidate.run(ctx)
    await ground.run(ctx)
    return ctx


async def test_calibration_exact_formula() -> None:
    ctx = await context_with_claims([raw_claim()])
    ctx.claims[0].verification = Verification(verdict="supported", rationale="Synthetic")
    await calibrate.run(ctx)
    confidence = ctx.claims[0].confidence
    assert confidence is not None
    assert confidence.score == pytest.approx(1 / (1 + math.exp(-(-1.6 + 2.2 + 1.8 + 0.45))))


@pytest.mark.parametrize(
    ("verdict", "expected"),
    [
        ("not_supported", "unsupported"),
        ("contradicted", "contradicted"),
        ("partially_supported", "single_source"),
        ("unverifiable", "single_source"),
    ],
)
async def test_calibration_verdict_classes(verdict: str, expected: str) -> None:
    ctx = await context_with_claims([raw_claim()])
    ctx.claims[0].verification = Verification.model_validate(
        {"verdict": verdict, "rationale": "Synthetic"}
    )
    await calibrate.run(ctx)
    assert ctx.claims[0].evidence_class == expected


async def test_reporter_only_stays_unverifiable_allegation() -> None:
    ctx = await context_with_claims(
        [
            raw_claim(
                kind="allegation",
                citations=[{"passage_id": "S.P001", "quote": "I believe the review was delayed."}],
            )
        ]
    )
    await verify.run(ctx)
    await calibrate.run(ctx)
    assert ctx.claims[0].verification is not None
    assert ctx.claims[0].verification.verdict == "unverifiable"
    assert ctx.claims[0].evidence_class == "reporter_allegation"


async def test_identical_documents_do_not_corroborate() -> None:
    ctx = await context_with_claims([raw_claim()])
    ctx.payload.documents[1].text = ctx.payload.documents[0].text
    ctx.passages = segment_payload(ctx.payload)
    citation = ctx.claims[0].citations[0].model_copy(update={"passage_id": "D2.P001"})
    ctx.claims[0].citations.append(citation)
    await ground.run(ctx)
    ctx.claims[0].verification = Verification(verdict="supported", rationale="Synthetic")
    await calibrate.run(ctx)
    assert ctx.claims[0].confidence is not None
    assert ctx.claims[0].confidence.independent_sources == 1
    assert ctx.claims[0].evidence_class == "documented"


async def test_medium_contradiction_changes_class() -> None:
    ctx = await context_with_claims([raw_claim(), raw_claim(claim_id="C002")])
    ctx.contradictions = [
        Contradiction(
            contradiction_id="X001",
            claim_ids=["C001", "C002"],
            description="Synthetic conflict",
            severity="medium",
        )
    ]
    await calibrate.run(ctx)
    assert all(claim.evidence_class == "contradicted" for claim in ctx.claims)


@pytest.mark.parametrize("relation", ["during", "same_time", "after", "before"])
async def test_temporal_relations_tighten_consistently(relation: str) -> None:
    ctx = await context_with_claims(
        [
            raw_claim(
                time_expression="October 2026",
                temporal_links=[
                    {
                        "relation": relation,
                        "other_claim_id": "C002",
                        "evidence_passage_id": "D1.P001",
                    }
                ],
            ),
            raw_claim(claim_id="C002", action="review", time_expression="15 October 2026"),
        ]
    )
    await temporal.run(ctx)
    first = ctx.claims[0].time
    assert first is not None
    assert ctx.temporal_conflicts == []
    if relation == "during":
        assert first.earliest == first.latest == date(2026, 10, 15)
    elif relation == "same_time":
        assert first.earliest == date(2026, 10, 14)
        assert first.latest == date(2026, 10, 16)
    elif relation == "before":
        assert first.latest == date(2026, 10, 15)
    else:
        assert first.earliest == date(2026, 10, 15)


async def test_timeline_merge_does_not_modify_claim_time() -> None:
    ctx = await context_with_claims(
        [
            raw_claim(time_expression="early October 2026"),
            raw_claim(claim_id="C002", time_expression="October 2026"),
        ]
    )
    await temporal.run(ctx)
    assert len(ctx.timeline) == 1
    assert ctx.claims[0].time is not None
    assert ctx.claims[0].time.latest == date(2026, 10, 10)
    assert ctx.timeline[0].interval.latest == date(2026, 10, 31)


@pytest.mark.parametrize("expression", ["0000", "31 February 2026", "two million weeks later"])
def test_invalid_dates_are_unknown(expression: str) -> None:
    assert normalize_time(expression, date(2026, 10, 26)).granularity == "unknown"


def test_unknown_time_without_anchor_is_unbounded() -> None:
    interval = normalize_time(None, None)
    assert interval.earliest == date.min
    assert interval.latest == date.max


def test_cli_record_preserves_nonce_for_replay(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    cassettes = tmp_path / "cassettes"
    monkeypatch.setattr("candor_pipeline.cli.build_provider", lambda spec: FakeProvider())
    recording = CliRunner().invoke(
        app, ["run", str(FIXTURE), "--synthetic", "--record", str(cassettes)]
    )
    assert recording.exit_code == 0, recording.output
    assert (cassettes / "run.json").is_file()
    monkeypatch.setattr(
        "candor_pipeline.cli.build_provider", lambda spec: ReplayProvider(cassettes)
    )
    replay = CliRunner().invoke(app, ["run", str(FIXTURE), "--provider", "replay"])
    assert replay.exit_code == 0, replay.output
