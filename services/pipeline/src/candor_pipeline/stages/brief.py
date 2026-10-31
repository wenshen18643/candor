import re

from candor_pipeline.contracts import BriefSummary
from candor_pipeline.stages.context import PipelineContext, StageOutput


def valid_key_point(point: str, supported: set[str], known: set[str]) -> bool:
    ending = re.search(r"\[((?:C\d{3,})(?:\s*,\s*C\d{3,})*)\]\.?\s*$", point)
    if not ending:
        return False
    references = set(re.findall(r"\bC\d{3,}\b", point))
    return bool(references & supported) and references <= known


async def run(ctx: PipelineContext) -> StageOutput:
    output = await ctx.ask(
        "brief",
        BriefSummary,
        passages=[],
        context={
            "claims": [claim.model_dump(mode="json") for claim in ctx.claims],
            "temporal_conflicts": [item.model_dump() for item in ctx.temporal_conflicts],
            "contradictions": [item.model_dump() for item in ctx.contradictions],
        },
    )
    if output is None:
        return StageOutput(True, ["summary_unavailable"])
    known = {claim.claim_id for claim in ctx.claims}
    supported = {claim.claim_id for claim in ctx.claims if claim.evidence_class != "unsupported"}
    original_count = len(output.key_points)
    output.key_points = [
        point for point in output.key_points if valid_key_point(point, supported, known)
    ]
    ctx.summary = output
    return StageOutput(degraded=len(output.key_points) != original_count)
