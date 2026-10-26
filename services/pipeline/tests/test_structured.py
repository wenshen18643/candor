import json
from typing import Any

import pytest
from pydantic import BaseModel

from candor_pipeline.providers.base import LLMRequest, LLMResponse
from candor_pipeline.providers.chaos import ChaosProvider
from candor_pipeline.stages.models import Extraction
from candor_pipeline.structured import (
    complete_structured,
    extract_json,
    strict_schema,
    validate_references,
)
from tests.helpers import raw_claim


class Probe(BaseModel):
    ok: bool


class SequenceProvider:
    def __init__(self, responses: list[str]) -> None:
        self.responses = iter(responses)
        self.requests: list[LLMRequest] = []

    async def complete_json(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        return LLMResponse(text=next(self.responses))


def request() -> LLMRequest:
    return LLMRequest(
        stage="extract",
        system="Return JSON",
        user="Synthetic test",
        schema_name="Probe",
        json_schema=strict_schema(Probe),
    )


@pytest.mark.parametrize(
    "text", ['{"ok":true}', 'Prose {"ok":true} tail', '```json\n{"ok":true}\n```']
)
def test_extract_json(text: str) -> None:
    assert extract_json(text) == {"ok": True}


def test_balanced_json_handles_quotes_and_braces() -> None:
    assert extract_json('prefix {"value":"a } \\" b", "nested": {}} suffix')["nested"] == {}


@pytest.mark.parametrize("text", ["", "[]", '{"ok":', "no json"])
def test_invalid_json(text: str) -> None:
    with pytest.raises(ValueError, match=r"no_json_object|expected_object"):
        extract_json(text)


def test_schema_inline_strict() -> None:
    schema = strict_schema(Extraction)
    assert "$ref" not in json.dumps(schema)
    assert "$defs" not in schema

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            if value.get("type") == "object":
                assert value["additionalProperties"] is False
                assert set(value["required"]) == set(value["properties"])
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(schema)


async def test_repairs_and_sanitized_validation_feedback() -> None:
    provider = SequenceProvider(['{"ok":{"sensitive":"secret-value"}}', '{"ok":true}'])
    result = await complete_structured(provider, request(), Probe)
    assert result.value == Probe(ok=True)
    assert result.repairs == 1
    assert not result.degraded
    assert "secret-value" not in provider.requests[-1].user


async def test_semantic_unknown_reference_repair() -> None:
    bad = raw_claim(citations=[{"passage_id": "D99.P001", "quote": "text"}])
    good = raw_claim()
    provider = SequenceProvider(
        [json.dumps({"claims": [bad.model_dump()]}), json.dumps({"claims": [good.model_dump()]})]
    )
    result = await complete_structured(
        provider,
        request(),
        Extraction,
        lambda value: validate_references(value.model_dump(), {"D1.P001"}),
    )
    assert result.repairs == 1
    assert result.value is not None
    assert result.value.claims == [good]


async def test_salvages_only_valid_items() -> None:
    bad = raw_claim(citations=[{"passage_id": "D99.P001", "quote": "text"}])
    text = json.dumps({"claims": [bad.model_dump(), raw_claim().model_dump(), {"bad": 2}]})
    result = await complete_structured(
        SequenceProvider([text] * 3),
        request(),
        Extraction,
        lambda value: validate_references(value.model_dump(), {"D1.P001"}),
    )
    assert result.degraded
    assert result.repairs == 2
    assert result.value is not None
    assert result.value.claims == [raw_claim()]


async def test_chaos_prose_recovers_without_repair() -> None:
    provider = ChaosProvider(SequenceProvider(['{"ok":true}']), p=1, fault="prose")
    result = await complete_structured(provider, request(), Probe)
    assert result.value == Probe(ok=True)
    assert result.repairs == 0


async def test_chaos_truncated_degrades() -> None:
    provider = ChaosProvider(SequenceProvider(['{"ok":true}'] * 3), p=1, fault="truncated")
    result = await complete_structured(provider, request(), Probe)
    assert result.value is None
    assert result.degraded


@pytest.mark.parametrize(
    "value",
    [
        {"passage_id": "missing"},
        {"passages": ["missing"]},
        {"claim_id": "missing"},
        {"related_claim_ids": ["missing"]},
        {"other_claim_id": "missing"},
        {"checked_passages": ["missing"]},
    ],
)
def test_reference_validation(value: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match=r"unknown_.*_reference"):
        validate_references(value, {"D1.P001"}, {"C001"})
