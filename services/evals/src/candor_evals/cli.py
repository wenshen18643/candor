from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from typing import Annotated

import typer

from candor_evals.bench import run_benchmark
from candor_evals.models import RunOptions
from candor_evals.pipeline_adapter import RealPipelineAdapter
from candor_evals.privacy_adapter import NodePrivacyAdapter
from candor_evals.runner import run_evaluation, select_scenarios
from candor_evals.synth import generate

COMPONENT = Path(__file__).resolve().parents[2]
ROOT = COMPONENT.parents[1]
app = typer.Typer(no_args_is_help=True, pretty_exceptions_enable=False)


def local_path(path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(COMPONENT):
        raise typer.BadParameter("Output must stay inside services/evals")
    return resolved


def validate_provider(value: str) -> str:
    if not re.fullmatch(r"(?:codex|meta|fireworks|baseten|replay)(?::[A-Za-z0-9_./:-]+)?", value):
        raise typer.BadParameter(
            "Expected codex, meta, fireworks, baseten or replay, optionally :model"
        )
    return value


@app.command()
def synth(
    seed: int = 42, output: Annotated[Path, typer.Option()] = COMPONENT / "scenarios"
) -> None:
    directories = generate(local_path(output), seed)
    typer.echo(f"Generated {len(directories)} synthetic scenarios")


@app.command()
def run(
    provider: str = "",
    scenarios: str = "all",
    samples: Annotated[int, typer.Option(min=1, max=12)] = 3,
    chaos: Annotated[float, typer.Option(min=0.0, max=1.0)] = 0.0,
    record: bool = False,
    seed: int = 42,
    scenario_dir: Path = COMPONENT / "scenarios",
    results_dir: Path = COMPONENT / "results",
    publish: bool = True,
) -> None:
    chosen = validate_provider(provider or os.getenv("CANDOR_LLM_PROVIDER", "replay"))
    if record and chosen.split(":")[0] == "replay":
        raise typer.BadParameter("--record requires a live provider")
    try:
        summary = asyncio.run(
            run_evaluation(
                select_scenarios(scenario_dir, scenarios),
                NodePrivacyAdapter(ROOT),
                RealPipelineAdapter(COMPONENT / "cassettes"),
                RunOptions(provider=chosen, samples=samples, chaos=chaos, record=record, seed=seed),
                local_path(results_dir),
                ROOT / "apps/web/public/data/evals-latest.json" if publish else None,
            )
        )
    except Exception as error:
        typer.echo(
            f"Evaluation failed ({type(error).__name__}); verify privacy CLI and pipeline setup",
            err=True,
        )
        raise typer.Exit(1) from None
    typer.echo(
        f"Evaluated {summary['aggregate']['scenarios_total']} scenarios; "
        f"execution failures: {summary['aggregate']['scenarios_failed']}"
    )
    if summary["aggregate"]["scenarios_failed"]:
        raise typer.Exit(1)


@app.command()
def bench(
    providers: Annotated[str, typer.Option()],
    repeats: Annotated[int, typer.Option(min=1, max=100)] = 3,
    scenario_dir: Path = COMPONENT / "scenarios",
    results_dir: Path = COMPONENT / "results",
    router: Path = COMPONENT / "router.json",
    publish: bool = True,
) -> None:
    choices = [validate_provider(value.strip()) for value in providers.split(",")]
    try:
        summary = asyncio.run(
            run_benchmark(
                choices,
                scenario_dir,
                NodePrivacyAdapter(ROOT),
                RealPipelineAdapter(COMPONENT / "cassettes"),
                local_path(results_dir),
                local_path(router),
                ROOT / "apps/web/public/data/bench-latest.json" if publish else None,
                repeats,
            )
        )
    except Exception as error:
        typer.echo(f"Benchmark failed ({type(error).__name__}); verify integration setup", err=True)
        raise typer.Exit(1) from None
    typer.echo(
        f"Benchmarked {len(summary['results'])} provider/stage pairs; "
        f"skipped {len(summary['skipped'])}; failed {len(summary['failures'])}"
    )
    if summary["failures"]:
        raise typer.Exit(1)


@app.command()
def health() -> None:
    typer.echo('{"service":"candor-evals","status":"ok"}')


if __name__ == "__main__":
    app()
