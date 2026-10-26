from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from candor_pipeline.contracts import AnalysisResult
from pydantic import Field

from candor_evals.metrics.matching import match_claims
from candor_evals.metrics.quality import quality_metrics
from candor_evals.models import Boundary, GroundTruth, Pseudonym, RunOptions, load_truth
from candor_evals.pipeline_adapter import PipelineAdapter, missing_credentials
from candor_evals.privacy_adapter import PrivacyAdapter
from candor_evals.reports import atomic_write, utc_now, write_json
from candor_evals.runner import execute

STAGES = ("extract", "verify", "gaps")
SUBSET = ("procurement-kickback", "patient-data-breach-concealment", "wage-theft-timesheet-edits")


class StageObservation(Boundary):
    provider: str
    stage: str
    quality: float = Field(ge=0, le=1)
    latency_ms: float = Field(ge=0)
    cost_usd: float = Field(ge=0)
    degraded: bool


class BenchmarkPoint(Boundary):
    provider: str
    stage: str
    quality: float
    p50_latency_ms: float
    p95_latency_ms: float
    cost_usd: float
    observations: int
    degraded_rate: float
    pareto: bool = False


def f1(precision: float | None, recall: float | None) -> float:
    if precision is None or recall is None or precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def stage_quality(
    stage: str, result: AnalysisResult, truth: GroundTruth, pseudonyms: list[Pseudonym]
) -> float:
    metrics = quality_metrics(result, truth, pseudonyms)
    if stage == "extract":
        matched = metrics["events_matched"] or 0
        precision = matched / len(result.claims) if result.claims else 0.0
        return f1(precision, metrics["event_recall"])
    if stage == "gaps":
        return float(metrics["gap_coverage"] or 0.0)
    matches = match_claims(result.claims, truth, pseudonyms)
    expected = {item.claim_index for item in matches}
    predicted = {
        index
        for index, claim in enumerate(result.claims)
        if claim.verification and claim.verification.verdict == "supported"
    }
    correct = len(expected & predicted)
    return f1(
        correct / len(predicted) if predicted else 0, correct / len(expected) if expected else 0
    )


def pareto_front(points: list[BenchmarkPoint]) -> list[BenchmarkPoint]:
    def dominates(a: BenchmarkPoint, b: BenchmarkPoint) -> bool:
        return (
            a.quality >= b.quality
            and a.cost_usd <= b.cost_usd
            and a.p95_latency_ms <= b.p95_latency_ms
            and (
                a.quality > b.quality
                or a.cost_usd < b.cost_usd
                or a.p95_latency_ms < b.p95_latency_ms
            )
        )

    return [
        point
        for point in points
        if not any(other.stage == point.stage and dominates(other, point) for other in points)
    ]


def choose_router(points: list[BenchmarkPoint], tolerance: float = 0.02) -> dict[str, str]:
    router = {}
    for stage in STAGES:
        choices = [point for point in points if point.stage == stage]
        if not choices:
            continue
        best = max(point.quality for point in choices)
        qualified = [point for point in choices if point.quality + tolerance + 1e-12 >= best]
        chosen = min(
            qualified, key=lambda point: (point.cost_usd, point.p95_latency_ms, point.provider)
        )
        router[stage] = chosen.provider
    if "extract" in router:
        router["default"] = router["extract"]
    return router


def aggregate_observations(observations: list[StageObservation]) -> list[BenchmarkPoint]:
    points = []
    for provider, stage in sorted({(item.provider, item.stage) for item in observations}):
        subset = [
            item for item in observations if item.provider == provider and item.stage == stage
        ]
        latencies = [item.latency_ms for item in subset]
        points.append(
            BenchmarkPoint(
                provider=provider,
                stage=stage,
                quality=sum(item.quality for item in subset) / len(subset),
                p50_latency_ms=float(np.percentile(latencies, 50)),
                p95_latency_ms=float(np.percentile(latencies, 95)),
                cost_usd=sum(item.cost_usd for item in subset) / len(subset),
                observations=len(subset),
                degraded_rate=sum(item.degraded for item in subset) / len(subset),
            )
        )
    front = {(point.provider, point.stage) for point in pareto_front(points)}
    return [
        point.model_copy(update={"pareto": (point.provider, point.stage) in front})
        for point in points
    ]


def observations_for(
    provider: str, result: AnalysisResult, truth: GroundTruth, pseudonyms: list[Pseudonym]
) -> list[StageObservation]:
    observations = []
    for stage in STAGES:
        runs = [item for item in result.stages if item.stage == stage]
        if not runs or any(item.status not in {"succeeded", "degraded"} for item in runs):
            raise ValueError("Benchmark stage missing or failed")
        observations.append(
            StageObservation(
                provider=provider,
                stage=stage,
                quality=stage_quality(stage, result, truth, pseudonyms),
                latency_ms=sum(item.duration_ms for item in runs),
                cost_usd=sum(item.cost_usd for item in runs),
                degraded=any(item.status == "degraded" for item in runs),
            )
        )
    return observations


def benchmark_markdown(summary: dict[str, Any]) -> str:
    lines = [
        "# Candor stage benchmark",
        "",
        f"Generated: {summary['generated_at']}",
        "",
        "| Provider | Stage | Quality | p50 ms | p95 ms | Mean cost USD | Pareto |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for point in summary["results"]:
        lines.append(
            f"| {point['provider']} | {point['stage']} | {point['quality']:.3f} | "
            f"{point['p50_latency_ms']:.1f} | {point['p95_latency_ms']:.1f} | "
            f"{point['cost_usd']:.6f} | {point['pareto']} |"
        )
    lines.extend(["", "## Skipped and failed", ""])
    lines.extend(
        f"- {item['provider']}: {item['reason']}"
        for item in summary["skipped"] + summary["failures"]
    )
    lines.extend(
        ["", "## Methodology", "", *[f"- {item}" for item in summary["methodology"].values()]]
    )
    return "\n".join(lines) + "\n"


async def run_benchmark(
    providers: list[str],
    scenario_root: Path,
    privacy: PrivacyAdapter,
    pipeline: PipelineAdapter,
    results_dir: Path,
    router_path: Path,
    public_path: Path | None = None,
    repeats: int = 3,
    check_credentials: bool = True,
) -> dict[str, Any]:
    if repeats < 1:
        raise ValueError("Benchmark repeats must be positive")
    available = []
    skipped = []
    for provider in dict.fromkeys(providers):
        reason = missing_credentials(provider) if check_credentials else None
        if reason:
            skipped.append({"provider": provider, "reason": reason})
        else:
            available.append(provider)
    prepared = []
    if available:
        for name in SUBSET:
            truth = load_truth(scenario_root / name)
            prepared.append((truth, await privacy.scrub(scenario_root / name, truth)))
    observations = []
    failures = []
    for provider in available:
        candidate = []
        failed = False
        for truth, scrubbed in prepared:
            for repeat in range(repeats):
                run = await execute(
                    pipeline,
                    scrubbed.payload,
                    RunOptions(provider=provider, samples=3, seed=repeat),
                )
                if run.result is None:
                    failed = True
                    continue
                try:
                    candidate.extend(
                        observations_for(provider, run.result, truth, scrubbed.pseudonym_map)
                    )
                except ValueError:
                    failed = True
        if failed:
            failures.append(
                {"provider": provider, "reason": "Incomplete benchmark; excluded from routing"}
            )
        else:
            observations.extend(candidate)
    points = aggregate_observations(observations)
    router = choose_router(points)
    timestamp = utc_now()
    summary = {
        "generated_at": timestamp,
        "subset": list(SUBSET),
        "repeats": repeats,
        "results": [point.model_dump() for point in points],
        "skipped": skipped,
        "failures": failures,
        "router": router,
        "router_written": bool(router),
        "methodology": {
            "quality": (
                "Scores are 0-1. Extract: matched-event F1. Verify: supported-verdict F1 "
                "against event matches. Gaps: expected-type coverage."
            ),
            "execution": (
                "Full DAG runs on a fixed subset; stage-local timings and costs, "
                "downstream quality as a proxy. Upstream errors can affect verify and gaps."
            ),
            "routing": (
                "Cheapest provider within 0.02 of best quality per stage; "
                "ties use p95 latency then provider name."
            ),
            "pareto": (
                "Non-dominated points maximize quality and minimize mean cost "
                "and p95 latency per stage."
            ),
        },
    }
    filename = timestamp.replace(":", "").replace(".", "-") + "-bench"
    write_json(results_dir / f"{filename}.json", summary)
    atomic_write(results_dir / f"{filename}.md", benchmark_markdown(summary))
    if router:
        write_json(router_path, router)
    if public_path is not None:
        write_json(public_path, summary)
    return summary
