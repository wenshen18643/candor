from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from candor_evals.models import GroundTruth, RunOptions
from candor_evals.pipeline_adapter import RealPipelineAdapter
from pydantic import BaseModel, Field

from tests.fakes import FakePrivacy


class FixtureUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0


class FixtureResponse(BaseModel):
    text: str
    data: dict[str, Any]
    usage: FixtureUsage = Field(default_factory=FixtureUsage)
    latency_ms: float = 0
    provider: str = "fixture"
    model: str = "empty-schema-fixture"


def minimal_value(schema: dict[str, Any], root: dict[str, Any]) -> Any:
    if "$ref" in schema:
        return minimal_value(root["$defs"][schema["$ref"].split("/")[-1]], root)
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    if "anyOf" in schema:
        return minimal_value(schema["anyOf"][0], root)
    kind = schema.get("type")
    if kind == "object":
        return {
            key: minimal_value(schema["properties"][key], root)
            for key in schema.get("required", [])
        }
    if kind == "array":
        return [minimal_value(schema["items"], root) for _ in range(schema.get("minItems", 0))]
    if kind in {"integer", "number"}:
        return schema.get("minimum", 0)
    if kind == "boolean":
        return False
    if kind == "null":
        return None
    return "Synthetic integration fixture"


class SchemaFixtureProvider:
    def __init__(self) -> None:
        self.calls = 0

    async def complete_json(self, request: Any) -> FixtureResponse:
        self.calls += 1
        data = minimal_value(request.json_schema, request.json_schema)
        return FixtureResponse(text=json.dumps(data), data=data)


async def test_real_public_pipeline_record_and_replay(
    scenario: Path, truth: GroundTruth, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pytest.importorskip("candor_pipeline.dag")
    registry = pytest.importorskip("candor_pipeline.providers.registry")
    provider = SchemaFixtureProvider()
    monkeypatch.setattr(registry, "build_provider", lambda spec: provider)
    monkeypatch.setenv("CANDOR_REPLAY_DIR", str(tmp_path / "cassettes"))
    scrubbed = await FakePrivacy().scrub(scenario, truth)
    adapter = RealPipelineAdapter(tmp_path / "cassettes")
    recorded = await adapter.run(scrubbed.payload, RunOptions(provider="meta:fixture", record=True))
    assert recorded.failure is None
    assert recorded.result is not None
    assert len(recorded.result.stages) == 12
    assert provider.calls > 0
    assert recorded.prompts
    calls = provider.calls
    replayed = await adapter.run(scrubbed.payload, RunOptions(provider="replay"))
    assert replayed.failure is None
    assert replayed.result is not None
    assert replayed.result.summary == recorded.result.summary
    assert provider.calls == calls
    assert list((tmp_path / "cassettes").glob("*.json"))
