import json
from pathlib import Path

from candor_pipeline.config import PipelineConfig
from candor_pipeline.contracts import AnalysisPayload
from candor_pipeline.dag import DAGRunner
from candor_pipeline.providers.replay import ReplayProvider
from candor_pipeline.router import Router

TESTS = Path(__file__).parent
SHOWCASE = TESTS.parents[2] / "apps/web/src/data/showcase-analysis.json"


async def test_showcase_analysis_is_what_the_recorded_run_produces() -> None:
    cassettes = TESTS / "cassettes/northwind"
    manifest = json.loads((cassettes / "run.json").read_text(encoding="utf-8"))
    payload = AnalysisPayload.model_validate_json(
        (TESTS / "fixtures/northwind_payload.json").read_bytes()
    )
    runner = DAGRunner(
        config=PipelineConfig(samples=manifest["samples"]), router=Router(ReplayProvider(cassettes))
    )
    result = (await runner.run(payload, nonce=manifest["nonce"])).model_dump(mode="json")
    showcase = json.loads(SHOWCASE.read_text(encoding="utf-8"))
    for key in (
        "claims",
        "passages",
        "timeline",
        "entities",
        "contradictions",
        "temporal_conflicts",
        "follow_up_questions",
        "injection_findings",
        "summary",
    ):
        assert result[key] == showcase[key], key
    assert result["metrics"]["citations_verified"] == result["metrics"]["citations_total"] == 35
