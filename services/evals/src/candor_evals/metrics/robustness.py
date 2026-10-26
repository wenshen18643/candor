from __future__ import annotations

import re

from candor_pipeline.contracts import AnalysisResult
from rapidfuzz.fuzz import partial_ratio

from candor_evals.metrics.quality import normalized, ratio
from candor_evals.models import PipelineRun


def invalid_item_count(result: AnalysisResult) -> int:
    passages = {item.passage_id: item for item in result.passages}
    claim_ids = {claim.claim_id for claim in result.claims}
    event_ids = {event.event_id for event in result.timeline}
    invalid = len(result.passages) - len(passages) + len(result.claims) - len(claim_ids)
    invalid += len(result.timeline) - len(event_ids)
    for claim in result.claims:
        for citation in claim.citations:
            passage = passages.get(citation.passage_id)
            invalid += int(passage is None or not citation.quote.strip())
            if passage and citation.quote_verified:
                invalid += int(
                    partial_ratio(normalized(citation.quote), normalized(passage.text)) < 95
                )
                start, end = citation.match_start, citation.match_end
                invalid += int(
                    start is not None
                    and end is not None
                    and not 0 <= start < end <= len(passage.text)
                )
        invalid += sum(
            link.other_claim_id not in claim_ids
            or (link.evidence_passage_id is not None and link.evidence_passage_id not in passages)
            for link in claim.temporal_links
        )
        if claim.time:
            invalid += int(claim.time.earliest > claim.time.latest)
        if claim.verification:
            invalid += sum(item not in passages for item in claim.verification.checked_passages)
    for event in result.timeline:
        invalid += sum(item not in claim_ids for item in event.claim_ids)
        invalid += int(event.interval.earliest > event.interval.latest)
    for contradiction in result.contradictions:
        invalid += sum(item not in claim_ids for item in contradiction.claim_ids)
        invalid += sum(item not in passages for item in contradiction.passages)
    for conflict in result.temporal_conflicts:
        invalid += sum(
            item not in event_ids and item not in claim_ids for item in conflict.event_ids
        )
        invalid += sum(item not in passages for item in conflict.passages)
    for question in result.follow_up_questions:
        invalid += sum(item not in claim_ids for item in question.related_claim_ids)
    entity_ids = {item.entity_id for item in result.entities}
    placeholders = {item.placeholder for item in result.entities}
    for relation in result.relations:
        invalid += int(relation.source not in entity_ids | placeholders)
        invalid += int(relation.target not in entity_ids | placeholders)
        invalid += sum(item not in claim_ids for item in relation.claim_ids)
    invalid += sum(item.passage_id not in passages for item in result.injection_findings)
    invalid += sum(
        reference not in claim_ids
        for point in result.summary.key_points
        for group in re.findall(r"\[([^\]]+)\]", point)
        for reference in re.findall(r"C\d{3,}", group)
    )
    return invalid


def robustness_metrics(run: PipelineRun) -> dict[str, float | int | None]:
    stages = run.result.stages if run.result else []
    repaired = [stage for stage in stages if stage.repairs > 0]
    return {
        "schema_valid_final_result_rate": float(run.result is not None and run.schema_valid),
        "run_completed_rate": float(run.result is not None),
        "repair_success_rate": ratio(
            sum(stage.status == "succeeded" for stage in repaired), len(repaired)
        ),
        "stages_requiring_repair": len(repaired),
        "degraded_stage_rate": ratio(
            sum(stage.status == "degraded" for stage in stages), len(stages)
        ),
        "invalid_items_in_result": invalid_item_count(run.result) if run.result else 0,
    }
