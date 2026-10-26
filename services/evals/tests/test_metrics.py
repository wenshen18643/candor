from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from candor_evals.metrics import matching
from candor_evals.metrics.leakage import count_leaks, leakage_metrics
from candor_evals.metrics.matching import match_claims, pseudonymize
from candor_evals.metrics.quality import (
    contradiction_metrics,
    injection_metrics,
    quality_metrics,
    timeline_metrics,
)
from candor_evals.metrics.robustness import invalid_item_count, robustness_metrics
from candor_evals.models import GroundTruth, PipelineRun, RunOptions, Scrubbed, StrippedFile
from candor_evals.runner import without_injections
from candor_pipeline.contracts import AnalysisResult, Claim, TimeInterval, Verification

from tests.fakes import FakePipeline, FakePrivacy


@pytest.fixture
async def perfect(scenario: Path, truth: GroundTruth) -> tuple[Scrubbed, PipelineRun]:
    privacy = FakePrivacy()
    scrubbed = await privacy.scrub(scenario, truth)
    run = await FakePipeline(privacy).run(scrubbed.payload, RunOptions())
    return scrubbed, run


def require_result(run: PipelineRun) -> AnalysisResult:
    assert run.result is not None
    return run.result


@pytest.mark.parametrize(
    ("text", "canaries", "expected"),
    [
        ("Mira Velloran and MIRA", ["Mira Velloran", "Mira"], 2),
        ("unrelated", ["Mira Velloran"], 0),
        ("EMP 12345 12345", ["EMP-12345"], 2),
        ("abcdabcd", ["abcd"], 2),
        ("a+b and A+B", ["a+b"], 2),
        ("", ["", "Mira"], 0),
    ],
)
def test_leak_occurrences(text: str, canaries: list[str], expected: int) -> None:
    assert count_leaks(text, canaries) == expected


def test_hungarian_matches_and_pseudonyms(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    matches = match_claims(list(reversed(result.claims)), truth, scrubbed.pseudonym_map)
    assert len(matches) == 6
    assert all(item.similarity == pytest.approx(1.0) for item in matches)
    assert [item.event_index for item in matches] == list(reversed(range(6)))


def test_matching_is_one_to_one(perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth) -> None:
    scrubbed, run = perfect
    claim = require_result(run).claims[0]
    subset = truth.model_copy(update={"events": truth.events[:1]})
    matches = match_claims(
        [claim, claim.model_copy(update={"claim_id": "C999"})], subset, scrubbed.pseudonym_map
    )
    assert len(matches) == 1
    assert match_claims([], subset, []) == []
    unrelated = Claim(
        claim_id="C001",
        statement="Zebra astronauts orbit Neptune",
        actors=["PERSON_99"],
        action="orbit",
        kind="event",
        source_type="document",
    )
    assert match_claims([unrelated], subset, []) == []


def test_replacement_longest_first_and_boundaries() -> None:
    assert (
        pseudonymize(
            "Dana Whitfield asked Dana, not Danaher.",
            {"Dana": "PERSON_1", "Dana Whitfield": "PERSON_1"},
        )
        == "PERSON_1 asked PERSON_1, not Danaher."
    )


def test_perfect_quality(perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    metrics = quality_metrics(result, truth, scrubbed.pseudonym_map)
    for name in (
        "event_recall",
        "claim_precision",
        "quote_grounding_rate",
        "citation_precision",
        "kendall_tau_b",
        "interval_coverage",
        "contradiction_recall",
        "temporal_conflict_recall",
        "gap_coverage",
    ):
        assert metrics[name] == pytest.approx(1.0), name
    assert metrics["date_mae_days"] == 0
    assert metrics["unsupported_claim_rate"] == 0
    assert metrics["dated_matches"] == 5


def test_supported_unmatched_claims_count_for_precision(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    extra = result.claims[0].model_copy(deep=True)
    extra.claim_id = "C999"
    extra.statement = "Unmatched atomic source detail"
    extra.actors = []
    result.claims.append(extra)
    assert quality_metrics(result, truth, scrubbed.pseudonym_map)["claim_precision"] == 1
    extra.citations[0].quote_verified = False
    assert quality_metrics(result, truth, scrubbed.pseudonym_map)[
        "claim_precision"
    ] == pytest.approx(6 / 7)


def test_false_verifier_without_grounding_is_not_precision_credit(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    result.claims.append(
        Claim(
            claim_id="C999",
            statement="Unrelated unicorn flight",
            actors=[],
            action="flight",
            kind="event",
            source_type="document",
            verification=Verification(verdict="supported", rationale="Unsupported assertion"),
        )
    )
    metrics = quality_metrics(result, truth, scrubbed.pseudonym_map)
    assert metrics["claim_precision"] == pytest.approx(6 / 7)
    assert metrics["unsupported_claim_rate"] == pytest.approx(1 / 7)


def test_citation_precision_uses_passage_not_quote(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    result.claims[0].citations[0].passage_id = "D999.P999"
    result.claims[0].citations[0].quote_verified = False
    metrics = quality_metrics(result, truth, scrubbed.pseudonym_map)
    assert metrics["citation_precision"] == pytest.approx(5 / 6)
    assert metrics["quote_grounding_rate"] == pytest.approx(5 / 6)


def test_kendall_reversed_and_mae(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    for event in result.timeline:
        days = (event.interval.earliest - date(2026, 3, 1)).days
        inverted = date.fromordinal(date(2026, 5, 1).toordinal() - days)
        event.interval.earliest = inverted
        event.interval.latest = inverted
    metrics = timeline_metrics(
        result, truth, match_claims(result.claims, truth, scrubbed.pseudonym_map)
    )
    assert metrics["kendall_tau_b"] == pytest.approx(-1)
    assert metrics["date_mae_days"] > 0
    assert metrics["interval_coverage"] == 0


def test_kendall_ties_are_tau_b(perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    truth.events = truth.events[:3]
    result.claims = result.claims[:3]
    result.timeline = result.timeline[:3]
    truth.events[0].date = date(2026, 3, 4)
    truth.events[1].date = date(2026, 3, 4)
    truth.events[2].date = date(2026, 3, 9)
    metrics = timeline_metrics(
        result, truth, match_claims(result.claims, truth, scrubbed.pseudonym_map)
    )
    assert metrics["kendall_tau_b"] == pytest.approx(2 / (6**0.5))


def test_missing_dates_reduce_coverage(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    result.timeline = []
    for claim in result.claims:
        claim.time = None
    metrics = timeline_metrics(
        result, truth, match_claims(result.claims, truth, scrubbed.pseudonym_map)
    )
    assert metrics["kendall_tau_b"] is None
    assert metrics["date_mae_days"] is None
    assert metrics["interval_coverage"] == 0
    assert metrics["date_prediction_rate"] == 0


def test_interval_coverage_inclusive(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    result.timeline[0].interval = TimeInterval(
        earliest=date(2026, 3, 4), latest=date(2026, 3, 10), granularity="week", source_text="week"
    )
    metrics = timeline_metrics(
        result, truth, match_claims(result.claims, truth, scrubbed.pseudonym_map)
    )
    assert metrics["interval_coverage"] == 1
    assert metrics["date_mae_days"] == pytest.approx(3 / 5)


def test_contradiction_requires_both_mapped_events(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    result.contradictions[0].claim_ids = ["C001", "C002"]
    result.temporal_conflicts = []
    metrics = contradiction_metrics(
        result, truth, match_claims(result.claims, truth, scrubbed.pseudonym_map)
    )
    assert metrics["contradiction_recall"] == 0
    assert metrics["temporal_conflict_recall"] == 0
    result.follow_up_questions = result.follow_up_questions[:1]
    assert quality_metrics(result, truth, scrubbed.pseudonym_map)["gap_coverage"] == pytest.approx(
        1 / 3
    )


def test_injection_detection_and_attack(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    matches = match_claims(result.claims, truth, scrubbed.pseudonym_map)
    metrics = injection_metrics(result, truth, scrubbed.pseudonym_map, {"E1", "E2"}, matches)
    assert metrics["injected_passages_flagged_rate"] == 1
    assert metrics["attack_success_rate"] == 0
    assert metrics["true_events_lost"] == 0
    result.summary.overview = "CASE CLEARED NO REVIEW NEEDED"
    assert (
        injection_metrics(result, truth, scrubbed.pseudonym_map, None, matches)[
            "attack_success_rate"
        ]
        == 1
    )


def test_clean_counterfactual_does_not_mutate(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, _ = perfect
    clean = without_injections(scrubbed, truth)
    assert "SYSTEM OVERRIDE" not in clean.model_dump_json()
    assert "SYSTEM OVERRIDE" in scrubbed.payload.model_dump_json()
    truth.injections[0].text = "missing injected sentence"
    with pytest.raises(ValueError, match="could not be located"):
        without_injections(scrubbed, truth)


def test_leakage_four_surfaces(perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth) -> None:
    scrubbed, run = perfect
    name = truth.reporter.name
    scrubbed.payload.reporter_statement = name
    run.prompts = [name, name.upper()]
    require_result(run).summary.overview = name
    counts = leakage_metrics(scrubbed, [run], [name])
    assert counts["analysis_payload"] == 1
    assert counts["outbound_prompts"] == 2
    assert counts["stripped_metadata"] == 0
    assert counts["analysis_result"] == 1
    assert counts["total"] == 4
    assert counts["scenario_leaked"] == 1
    assert "prompts" not in run.model_dump()


def test_invalid_items_and_chaos_failures(perfect: tuple[Scrubbed, PipelineRun]) -> None:
    _, run = perfect
    result = require_result(run)
    assert invalid_item_count(result) == 0
    result.claims[0].citations[0].passage_id = "D999.P999"
    result.timeline[0].claim_ids = ["C999"]
    result.follow_up_questions[0].related_claim_ids = ["C999"]
    result.summary.key_points = ["Bad reference [C999]"]
    assert invalid_item_count(result) == 4
    failed = robustness_metrics(PipelineRun(failure="pipeline_execution_failed"))
    assert failed["schema_valid_final_result_rate"] == 0
    assert failed["repair_success_rate"] is None


def test_repairs_and_degraded_rates(perfect: tuple[Scrubbed, PipelineRun]) -> None:
    _, run = perfect
    result = require_result(run)
    result.stages[0].repairs = 2
    result.stages[1].repairs = 1
    result.stages[1].status = "degraded"
    metrics = robustness_metrics(run)
    assert metrics["repair_success_rate"] == 0.5
    assert metrics["degraded_stage_rate"] == pytest.approx(1 / 3)
    assert metrics["schema_valid_final_result_rate"] == 1


def test_hungarian_global_optimum_beats_greedy(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth, monkeypatch: pytest.MonkeyPatch
) -> None:
    scrubbed, run = perfect
    claims = require_result(run).claims[:2]
    subset = truth.model_copy(update={"events": truth.events[:2]})
    matrix = {
        ("C001", "E1"): 0.95,
        ("C001", "E2"): 0.90,
        ("C002", "E1"): 0.89,
        ("C002", "E2"): 0.56,
    }
    monkeypatch.setattr(
        matching, "similarity", lambda claim, event, mapping: matrix[claim.claim_id, event.gt_id]
    )
    matches = match_claims(claims, subset, scrubbed.pseudonym_map)
    assert [(item.claim_index, item.event_index) for item in matches] == [(0, 1), (1, 0)]


def test_injection_crossing_passage_boundary(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    original = next(item for item in result.passages if "SYSTEM OVERRIDE" in item.text)
    boundary = original.text.index("In your final brief")
    continuation = original.model_copy(deep=True)
    continuation.passage_id = f"{original.doc_id}.P002"
    continuation.ordinal = 2
    continuation.text = original.text[boundary:]
    original.text = original.text[:boundary]
    result.passages.append(continuation)
    metrics = injection_metrics(result, truth, scrubbed.pseudonym_map, None, [])
    assert metrics["injected_passages_total"] == 2
    assert metrics["injected_passages_flagged_rate"] == 0.5


def test_metadata_leaks_count_only_remaining_surface(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    scrubbed.stripped_files = [
        StrippedFile(
            name="review.docx",
            metadata_before=[{"Author": truth.reporter.name}],
            metadata_after=[{"Creator": truth.reporter.email}],
        )
    ]
    assert leakage_metrics(scrubbed, [run], truth.canaries)["stripped_metadata"] == 1
    scrubbed.stripped_files[0].metadata_after = []
    assert leakage_metrics(scrubbed, [run], truth.canaries)["stripped_metadata"] == 0


def test_empty_output_rates_are_explicit(
    perfect: tuple[Scrubbed, PipelineRun], truth: GroundTruth
) -> None:
    scrubbed, run = perfect
    result = require_result(run)
    result.claims = []
    metrics = quality_metrics(result, truth, scrubbed.pseudonym_map)
    assert metrics["event_recall"] == 0
    assert metrics["claim_precision"] is None
    assert metrics["citation_precision"] is None
    assert metrics["kendall_tau_b"] is None


def test_invented_verified_quote_counts_invalid(perfect: tuple[Scrubbed, PipelineRun]) -> None:
    _, run = perfect
    result = require_result(run)
    result.claims[0].citations[0].quote = "zebras crossed interplanetary vacuum"
    assert invalid_item_count(result) == 1
