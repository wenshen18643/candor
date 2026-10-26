from __future__ import annotations

import json
from pathlib import Path

import pytest
from candor_evals import cli
from candor_evals.bench import BenchmarkPoint, choose_router, pareto_front, run_benchmark
from candor_evals.models import RunOptions, load_truth
from candor_evals.reports import averages, write_json
from candor_evals.runner import evaluate_scenario, run_evaluation, select_scenarios
from typer.testing import CliRunner

from tests.fakes import FakePipeline, FakePrivacy


async def test_full_run_fake_pipeline(scenario_root: Path, tmp_path: Path) -> None:
    privacy = FakePrivacy()
    pipeline = FakePipeline(privacy)
    summary = await run_evaluation(
        select_scenarios(scenario_root, "all"),
        privacy,
        pipeline,
        RunOptions(),
        tmp_path / "results",
        tmp_path / "public.json",
    )
    assert summary["aggregate"]["scenarios_total"] == 6
    assert summary["aggregate"]["scenarios_failed"] == 0
    assert summary["aggregate"]["event_recall"] == 1
    leaked = sum(item["leakage"]["scenario_leaked"] for item in summary["scenarios"])
    assert summary["leakage"]["overall_leak_rate"] == leaked / 6
    assert summary["chaos"]["schema_valid_final_result_rate"] == 1
    assert summary["chaos"]["invalid_items_in_result"] == 0
    assert summary["injection"]["attack_success_rate"] == 0
    assert len(list((tmp_path / "results").glob("*.md"))) == 1
    assert json.loads((tmp_path / "public.json").read_text()) == summary
    serialized = json.dumps(summary)
    for directory in scenario_root.iterdir():
        truth = load_truth(directory)
        assert truth.reporter.name not in serialized
        assert truth.events[0].quote not in serialized
    assert sum(options.chaos == 0.3 for options in pipeline.calls) == 6
    assert len(pipeline.calls) == 16


async def test_paired_injection_event_loss(scenario: Path) -> None:
    privacy = FakePrivacy()
    score = await evaluate_scenario(
        scenario, privacy, FakePipeline(privacy, lose_under_injection=True), RunOptions()
    )
    assert score.injection["true_events_lost"] == 1
    assert score.injection["true_events_lost_rate"] == pytest.approx(1 / 6)


async def test_chaos_failures_not_excluded_from_denominator(scenario: Path) -> None:
    privacy = FakePrivacy()
    score = await evaluate_scenario(
        scenario, privacy, FakePipeline(privacy, fail_chaos=True), RunOptions(chaos=0.9)
    )
    assert score.chaos["schema_valid_final_result_rate"] == 0
    assert score.failures == ["chaos: pipeline_execution_failed"]
    assert score.metrics["event_recall"] == 1


def point(
    provider: str, quality: float, cost: float, latency: float, stage: str = "extract"
) -> BenchmarkPoint:
    return BenchmarkPoint(
        provider=provider,
        stage=stage,
        quality=quality,
        cost_usd=cost,
        p50_latency_ms=latency,
        p95_latency_ms=latency,
        observations=3,
        degraded_rate=0,
    )


def test_pareto_and_router_two_percentage_points() -> None:
    points = [
        point("meta:best", 0.91, 0.1, 200),
        point("codex:cheap", 0.89, 0.01, 100),
        point("fireworks:weak", 0.88, 0.001, 80),
        point("baseten:dominated", 0.88, 0.2, 250),
    ]
    assert {item.provider for item in pareto_front(points)} == {
        "meta:best",
        "codex:cheap",
        "fireworks:weak",
    }
    assert choose_router(points) == {"extract": "codex:cheap", "default": "codex:cheap"}
    assert choose_router([]) == {}


def test_pareto_ties_and_stage_separation() -> None:
    points = [point("a", 1, 1, 1), point("b", 1, 1, 1), point("c", 0.1, 5, 10, "gaps")]
    assert len(pareto_front(points)) == 3
    assert choose_router(points)["extract"] == "a"
    assert choose_router(points)["gaps"] == "c"


async def test_benchmark_stage_metrics_and_router(scenario_root: Path, tmp_path: Path) -> None:
    privacy = FakePrivacy()
    summary = await run_benchmark(
        ["replay:fixture"],
        scenario_root,
        privacy,
        FakePipeline(privacy),
        tmp_path / "results",
        tmp_path / "router.json",
        tmp_path / "bench.json",
        repeats=2,
        check_credentials=False,
    )
    assert len(summary["results"]) == 3
    assert all(item["quality"] == 1 for item in summary["results"])
    assert all(item["observations"] == 6 for item in summary["results"])
    assert all(item["pareto"] for item in summary["results"])
    assert all(item["cost_usd"] == pytest.approx(0.01) for item in summary["results"])
    assert json.loads((tmp_path / "router.json").read_text()) == summary["router"]
    assert summary["router_written"]


async def test_missing_credentials_skip_without_scrubber(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    privacy = FakePrivacy()
    router = tmp_path / "router.json"
    router.write_text('{"default":"replay"}')
    summary = await run_benchmark(
        ["meta:muse-spark-1.3"],
        tmp_path / "nonexistent",
        privacy,
        FakePipeline(privacy),
        tmp_path,
        router,
    )
    assert summary["skipped"] == [
        {"provider": "meta:muse-spark-1.3", "reason": "MODEL_API_KEY is not configured"}
    ]
    assert not summary["router_written"]
    assert json.loads(router.read_text()) == {"default": "replay"}


def test_selection_and_no_nonfinite_json(scenario_root: Path, tmp_path: Path) -> None:
    assert len(select_scenarios(scenario_root, "all")) == 6
    assert len(select_scenarios(scenario_root, "procurement-kickback,procurement-kickback")) == 1
    with pytest.raises(ValueError, match="unknown scenario"):
        select_scenarios(scenario_root, "../escape")
    with pytest.raises(ValueError, match="JSON compliant"):
        write_json(tmp_path / "bad.json", {"score": float("nan")})
    assert averages([{"a": None}, {"a": 1}]) == {"a": 1}


def test_cli_smoke_and_failure_redaction(
    scenario: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    privacy = FakePrivacy()
    monkeypatch.setattr(cli, "COMPONENT", tmp_path)
    monkeypatch.setattr(cli, "NodePrivacyAdapter", lambda root: privacy)
    monkeypatch.setattr(cli, "RealPipelineAdapter", lambda directory: FakePipeline(privacy))
    result = CliRunner().invoke(
        cli.app,
        [
            "run",
            "--provider",
            "replay",
            "--scenario-dir",
            str(scenario.parent),
            "--scenarios",
            scenario.name,
            "--results-dir",
            str(tmp_path),
            "--no-publish",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "Evaluated 1 scenarios" in result.output
    assert load_truth(scenario).reporter.name not in result.output
    assert CliRunner().invoke(cli.app, ["health"]).exit_code == 0


def test_cli_refuses_outside_router_and_bad_provider(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "COMPONENT", tmp_path)
    with pytest.raises(Exception, match="inside services/evals"):
        cli.local_path(tmp_path.parent / "router.json")
    assert CliRunner().invoke(cli.app, ["run", "--provider", "../../escape"]).exit_code != 0
    assert CliRunner().invoke(cli.app, ["run", "--provider", "replay", "--record"]).exit_code != 0
