import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import orjson
from pydantic import BaseModel, ValidationError

from candor_pipeline.providers.base import LLMProvider, LLMRequest, LLMResponse


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    schema = model.model_json_schema()
    definitions = schema.pop("$defs", {})

    def expand(value: Any) -> Any:
        if isinstance(value, list):
            return [expand(item) for item in value]
        if not isinstance(value, dict):
            return value
        if "$ref" in value:
            return expand(definitions[value["$ref"].split("/")[-1]])
        result = {key: expand(item) for key, item in value.items() if key != "default"}
        if result.get("type") == "object":
            result["additionalProperties"] = False
            result["required"] = list(result.get("properties", {}))
        return result

    return expand(schema)


def extract_json(text: str) -> dict[str, Any]:
    try:
        value = orjson.loads(text)
    except orjson.JSONDecodeError:
        decoder = json.JSONDecoder()
        for index, character in enumerate(text):
            if character != "{":
                continue
            try:
                value, _ = decoder.raw_decode(text[index:])
                break
            except ValueError:
                continue
        else:
            raise ValueError("no_json_object") from None
    if not isinstance(value, dict):
        raise ValueError("expected_object")
    return value


def validate_references(data: Any, passages: set[str], claims: set[str] | None = None) -> None:
    passage_fields = {"passage_id", "evidence_passage_id"}
    passage_lists = {"passages", "checked_passages"}
    claim_fields = {"claim_id", "other_claim_id"}
    claim_lists = {"claim_ids", "related_claim_ids"}
    if isinstance(data, list):
        for item in data:
            validate_references(item, passages, claims)
    elif isinstance(data, dict):
        for key, value in data.items():
            if key in passage_fields and value is not None and value not in passages:
                raise ValueError("unknown_passage_reference")
            if key in passage_lists and any(item not in passages for item in value):
                raise ValueError("unknown_passage_reference")
            if claims is not None:
                if key in claim_fields and value is not None and value not in claims:
                    raise ValueError("unknown_claim_reference")
                if key in claim_lists and any(item not in claims for item in value):
                    raise ValueError("unknown_claim_reference")
            validate_references(value, passages, claims)


@dataclass
class StructuredResult[T: BaseModel]:
    value: T | None
    repairs: int = 0
    degraded: bool = False
    responses: list[LLMResponse] = field(default_factory=list)


def salvage[T: BaseModel](
    model: type[T], data: dict[str, Any], semantic: Callable[[T], None]
) -> T | None:
    clean: dict[str, Any] = {}
    for key, value in data.items():
        if key not in model.model_fields:
            continue
        if isinstance(value, list):
            accepted: list[Any] = []
            for item in value:
                candidate = {
                    name: []
                    for name, field_info in model.model_fields.items()
                    if getattr(field_info.annotation, "__origin__", None) is list
                }
                candidate[key] = [item]
                try:
                    parsed = model.model_validate(candidate)
                    semantic(parsed)
                    accepted.append(item)
                except (ValidationError, ValueError):
                    continue
            clean[key] = accepted
        else:
            clean[key] = value
    try:
        parsed = model.model_validate(clean)
        semantic(parsed)
        return parsed
    except (ValidationError, ValueError):
        return None


async def complete_structured[T: BaseModel](
    provider: LLMProvider,
    request: LLMRequest,
    model: type[T],
    semantic: Callable[[T], None] | None = None,
    max_repairs: int = 2,
) -> StructuredResult[T]:
    validator = semantic or (lambda value: None)
    responses: list[LLMResponse] = []
    data: dict[str, Any] = {}
    current = request.model_copy(update={"json_schema": strict_schema(model)})
    for attempt in range(max_repairs + 1):
        response = await provider.complete_json(current)
        responses.append(response)
        try:
            data = response.data if response.data is not None else extract_json(response.text)
            value = model.model_validate(data)
            validator(value)
            return StructuredResult(value, attempt, False, responses)
        except (ValueError, ValidationError) as error:
            if isinstance(error, ValidationError):
                errors = [
                    {"path": list(item["loc"]), "type": item["type"]}
                    for item in error.errors(include_input=False, include_context=False)
                ]
            else:
                errors = [{"type": "invalid_json_or_reference"}]
            current = request.model_copy(
                update={
                    "json_schema": strict_schema(model),
                    "user": request.user
                    + "\nValidation failed. Return a corrected complete object. "
                    + json.dumps(errors)
                    + f" Repair attempt {attempt + 1}.",
                }
            )
    return StructuredResult(salvage(model, data, validator), max_repairs, True, responses)
