from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

from candor_pipeline.contracts import AnalysisPayload, AnalysisResult, GapType, Granularity
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Boundary(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Reporter(Boundary):
    name: str
    email: str
    phone: str
    employee_id: str
    team: str


class Person(Boundary):
    name: str
    role: str
    aliases: list[str]


class TruthEvent(Boundary):
    gt_id: str
    description: str
    date: date | None
    granularity: Granularity
    actors: list[str]
    doc: str
    quote: str = Field(min_length=1)


class TruthContradiction(Boundary):
    a: str
    b: str
    note: str


class TruthInjection(Boundary):
    doc: str
    text: str
    target: str


class GroundTruth(Boundary):
    scenario_id: str = Field(pattern=r"^[a-z0-9-]+$")
    reporter: Reporter
    canaries: list[str]
    self_identifiers: list[str]
    people: list[Person]
    events: list[TruthEvent]
    contradictions: list[TruthContradiction]
    injections: list[TruthInjection]
    expected_gaps: list[GapType]

    @model_validator(mode="after")
    def check_references(self) -> GroundTruth:
        ids = {event.gt_id for event in self.events}
        if len(ids) != len(self.events):
            raise ValueError("Duplicate ground truth event IDs")
        if any(item.a not in ids or item.b not in ids for item in self.contradictions):
            raise ValueError("Unknown ground truth contradiction reference")
        return self


class Pseudonym(Boundary):
    placeholder: str
    type: str
    value: str
    variants: list[str] = Field(default_factory=list)


class StrippedFile(Boundary):
    name: str
    kind: str | None = None
    metadata_before: dict[str, Any] | list[dict[str, Any]]
    metadata_after: dict[str, Any] | list[dict[str, Any]]


class Scrubbed(Boundary):
    payload: AnalysisPayload
    pseudonym_map: list[Pseudonym]
    stripped_files: list[StrippedFile]
    leakage_estimate: Any


class PipelineRun(Boundary):
    result: AnalysisResult | None = None
    prompts: list[str] = Field(default_factory=list, exclude=True)
    failure: str | None = None
    schema_valid: bool = True


class RunOptions(Boundary):
    provider: str = Field(
        default="replay",
        pattern=r"^(claude|codex|meta|fireworks|baseten|replay)(:[A-Za-z0-9_./:-]+)?$",
    )
    samples: int = Field(default=3, ge=1, le=12)
    chaos: float = Field(default=0.0, ge=0.0, le=1.0)
    record: bool = False
    seed: int = 42


class ScenarioScore(Boundary):
    scenario_id: str
    title: str
    metrics: dict[str, float | int | None]
    leakage: dict[str, int]
    chaos: dict[str, float | int | None]
    injection: dict[str, float | int | None]
    failures: list[str] = Field(default_factory=list)


def load_truth(directory: Path) -> GroundTruth:
    return GroundTruth.model_validate_json((directory / "ground_truth.json").read_bytes())
