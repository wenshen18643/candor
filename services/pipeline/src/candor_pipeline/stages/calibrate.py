import math

from candor_pipeline.contracts import Confidence, ConfidenceLabel, EvidenceClass
from candor_pipeline.stages.context import PipelineContext, StageOutput

VERDICT_WEIGHT = {
    "supported": 1.0,
    "partially_supported": 0.6,
    "unverifiable": 0.0,
    "not_supported": -0.6,
    "contradicted": -1.2,
}


def confidence_label(score: float) -> ConfidenceLabel:
    if score >= 0.8:
        return "high"
    if score >= 0.6:
        return "moderate"
    return "low" if score >= 0.35 else "very_low"


def evidence_class(
    verdict: str, contradicted: bool, verified: bool, injected: bool, reporter: bool, sources: int
) -> EvidenceClass:
    if contradicted or verdict == "contradicted":
        return "contradicted"
    if verdict == "not_supported" or not verified or injected:
        return "unsupported"
    if reporter and sources == 0:
        return "reporter_allegation"
    if sources >= 2 and verdict == "supported":
        return "corroborated"
    if sources >= 1 and verdict == "supported":
        return "documented"
    return "single_source"


async def run(ctx: PipelineContext) -> StageOutput:
    passages = {passage.passage_id: passage for passage in ctx.passages}
    conflicted = {
        claim_id
        for item in ctx.contradictions
        if item.severity in {"medium", "high"}
        for claim_id in item.claim_ids
    }
    fingerprints = {
        document.doc_id: " ".join(document.text.split()) for document in ctx.payload.documents
    }
    for claim in ctx.claims:
        verified = [passages[cite.passage_id] for cite in claim.citations if cite.quote_verified]
        trusted = [
            passage
            for passage in verified
            if passage.injection_risk < ctx.config.quarantine_threshold
        ]
        injected = bool(verified) and not trusted
        if injected and "cites_injected_passage" not in claim.flags:
            claim.flags.append("cites_injected_passage")
        sources = len(
            {fingerprints[passage.doc_id] for passage in trusted if passage.doc_id != "S"}
        )
        verdict = claim.verification.verdict if claim.verification else "unverifiable"
        agreement = ctx.agreements.get(claim.claim_id, 0)
        contradicted = claim.claim_id in conflicted or verdict == "contradicted"
        logit = (
            -1.6
            + 2.2 * agreement
            + 1.8 * VERDICT_WEIGHT[verdict]
            + 0.45 * min(sources, 3)
            - 1.2 * contradicted
            - 1.5 * injected
        )
        score = 1 / (1 + math.exp(-logit))
        timing = (
            "date unresolved"
            if claim.time is None or claim.time.granularity == "unknown"
            else f"date precision: {claim.time.granularity}"
        )
        claim.confidence = Confidence(
            score=score,
            sample_agreement=agreement,
            independent_sources=sources,
            label=confidence_label(score),
            statement=f"{sources} distinct document sources with verified quotes; "
            f"{round(agreement * ctx.config.samples)}/{ctx.config.samples} "
            "extraction samples agree; "
            f"verification: {verdict.replace('_', ' ')}; {timing}.",
        )
        claim.evidence_class = evidence_class(
            verdict,
            contradicted,
            bool(verified),
            injected,
            claim.source_type == "reporter_statement",
            sources,
        )
    return StageOutput()
