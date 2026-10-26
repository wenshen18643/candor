import json
from pathlib import Path

import pytest

from candor_pipeline.config import PipelineConfig
from candor_pipeline.contracts import AnalysisResult
from candor_pipeline.dag import DAGRunner
from candor_pipeline.providers.replay import ReplayProvider
from tests.helpers import payload

CASSETTES = Path(__file__).parent / "cassettes" / "codex"


@pytest.mark.skipif(
    not (CASSETTES / "run.json").is_file(),
    reason="Live Codex recording blocked by sandbox app-server initialization access denial",
)
async def test_real_codex_cassette_replays_with_verified_citations() -> None:
    manifest = json.loads((CASSETTES / "run.json").read_text(encoding="utf-8"))
    assert manifest["source"] == "codex"
    runner = DAGRunner(ReplayProvider(CASSETTES), PipelineConfig(samples=manifest["samples"]))
    first = await runner.run(payload(), nonce=manifest["nonce"])
    second = await runner.run(payload(), nonce=manifest["nonce"])
    assert AnalysisResult.model_validate_json(first.model_dump_json()) == first
    assert first.claims == second.claims
    assert first.summary == second.summary
    assert first.claims
    assert first.metrics.citations_verified > 0
    assert all(
        any(cite.quote_verified for cite in claim.citations)
        for claim in first.claims
        if claim.evidence_class != "unsupported"
    )
