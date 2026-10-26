from __future__ import annotations

from pathlib import Path
from typing import Any

from candor_pipeline.contracts import AnalysisPayload, AnalysisResult

from candor_evals.metrics.leakage import leakage_metrics
from candor_evals.metrics.matching import match_claims, pseudonymize, replacements
from candor_evals.metrics.quality import injection_metrics, quality_metrics
from candor_evals.metrics.robustness import robustness_metrics
from candor_evals.models import (
    GroundTruth,
    PipelineRun,
    RunOptions,
    ScenarioScore,
    Scrubbed,
    load_truth,
)
from candor_evals.pipeline_adapter import PipelineAdapter, PipelineUnavailableError, provider_model
from candor_evals.privacy_adapter import PrivacyAdapter
from candor_evals.reports import atomic_write, markdown_report, summarize, utc_now, write_json


def select_scenarios(directory: Path, selection: str) -> list[Path]:
    available = {
        path.name: path
        for path in sorted(directory.iterdir())
        if path.is_dir() and (path / "ground_truth.json").is_file()
    }
    selected = (
        sorted(available) if selection == "all" else list(dict.fromkeys(selection.split(",")))
    )
    if not selected or any(name not in available for name in selected):
        raise ValueError(
            "No scenarios selected or an unknown scenario was requested; run synth first"
        )
    return [available[name] for name in selected]


def without_injections(scrubbed: Scrubbed, truth: GroundTruth) -> AnalysisPayload:
    payload = scrubbed.payload.model_copy(deep=True)
    mapping = replacements(scrubbed.pseudonym_map)
    for attack in truth.injections:
        text = pseudonymize(attack.text, mapping)
        removed = 0
        for document in payload.documents:
            removed += document.text.count(text)
            document.text = document.text.replace(text, "")
        if not removed:
            raise ValueError("Injected text could not be located in the scrubbed payload")
    return payload


async def execute(
    pipeline: PipelineAdapter, payload: AnalysisPayload, options: RunOptions
) -> PipelineRun:
    try:
        run = await pipeline.run(payload.model_copy(deep=True), options)
        if run.result is not None:
            AnalysisResult.model_validate(run.result.model_dump(mode="json"))
        return run
    except PipelineUnavailableError:
        raise
    except Exception:
        return PipelineRun(failure="pipeline_execution_failed", schema_valid=False)


async def evaluate_scenario(
    directory: Path, privacy: PrivacyAdapter, pipeline: PipelineAdapter, options: RunOptions
) -> ScenarioScore:
    truth = load_truth(directory)
    scrubbed = await privacy.scrub(directory, truth)
    baseline = await execute(pipeline, scrubbed.payload, options.model_copy(update={"chaos": 0.0}))
    chaos = await execute(
        pipeline, scrubbed.payload, options.model_copy(update={"chaos": options.chaos or 0.3})
    )
    runs = [baseline, chaos]
    clean_matches = None
    if truth.injections:
        clean = await execute(
            pipeline, without_injections(scrubbed, truth), options.model_copy(update={"chaos": 0.0})
        )
        runs.append(clean)
        if clean.result is not None:
            clean_matches = {
                truth.events[item.event_index].gt_id
                for item in match_claims(clean.result.claims, truth, scrubbed.pseudonym_map)
            }
    result = baseline.result
    metrics = (
        quality_metrics(result, truth, scrubbed.pseudonym_map)
        if result is not None
        else {
            "event_recall": 0.0,
            "claim_precision": None,
            "quote_grounding_rate": None,
            "citation_precision": None,
            "unsupported_claim_rate": None,
            "kendall_tau_b": None,
            "date_mae_days": None,
            "interval_coverage": 0.0,
            "temporal_conflict_recall": 0.0
            if any(item.note.startswith("Temporal:") for item in truth.contradictions)
            else None,
            "contradiction_recall": 0.0,
            "gap_coverage": 0.0,
            "events_total": len(truth.events),
            "events_matched": 0,
            "claims_total": 0,
        }
    )
    injection = (
        injection_metrics(
            result,
            truth,
            scrubbed.pseudonym_map,
            clean_matches,
            match_claims(result.claims, truth, scrubbed.pseudonym_map),
        )
        if result
        else {
            "injections_total": len(truth.injections),
            "injected_passages_flagged_rate": None,
            "attack_success_rate": None,
            "true_events_lost": None,
            "true_events_lost_rate": None,
        }
    )
    return ScenarioScore(
        scenario_id=truth.scenario_id,
        title=truth.scenario_id.replace("-", " ").title(),
        metrics=metrics,
        leakage=leakage_metrics(scrubbed, runs, truth.canaries),
        chaos=robustness_metrics(chaos),
        injection=injection,
        failures=[
            f"{label}: {run.failure}"
            for label, run in zip(("baseline", "chaos", "clean"), runs, strict=False)
            if run.failure
        ],
    )


async def run_evaluation(
    directories: list[Path],
    privacy: PrivacyAdapter,
    pipeline: PipelineAdapter,
    options: RunOptions,
    results_dir: Path,
    public_path: Path | None = None,
) -> dict[str, Any]:
    if not directories:
        raise ValueError("At least one scenario is required")
    scores = [
        await evaluate_scenario(directory, privacy, pipeline, options) for directory in directories
    ]
    provider, model = provider_model(options.provider)
    timestamp = utc_now()
    summary = summarize(scores, provider, model, timestamp, options.chaos or 0.3)
    filename = timestamp.replace(":", "").replace(".", "-") + "-" + provider
    write_json(results_dir / f"{filename}.json", summary)
    atomic_write(results_dir / f"{filename}.md", markdown_report(summary))
    if public_path is not None:
        write_json(public_path, summary)
    return summary
