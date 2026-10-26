import re

from candor_pipeline.stages.context import PipelineContext, StageOutput
from candor_pipeline.stages.models import GapsOutput


def requests_identity(question: str) -> bool:
    return bool(
        re.search(
            r"\b(?:your|reporter['’]s)\s+(?:own\s+)?(?:name|identity|role|job|position|department|"
            r"contact|email|phone|address|location|title)\b|\bwho are you\b|"
            r"\bwhere do you (?:work|live)\b",
            question,
            re.I,
        )
    )


async def run(ctx: PipelineContext) -> StageOutput:
    output = await ctx.ask(
        "gaps",
        GapsOutput,
        passages=[],
        context={
            "claims": [claim.model_dump(mode="json") for claim in ctx.claims],
            "entities": [entity.model_dump() for entity in ctx.entities],
            "temporal_conflicts": [conflict.model_dump() for conflict in ctx.temporal_conflicts],
        },
    )
    if output:
        for question in output.questions:
            if (
                not question.related_claim_ids
                or requests_identity(question.question)
                or requests_identity(question.rationale)
            ):
                continue
            question.question_id = f"Q{len(ctx.questions) + 1:03d}"
            ctx.questions.append(question)
            if len(ctx.questions) == 8:
                break
    return StageOutput(
        degraded=len(ctx.questions) < 3,
        notes=["insufficient_safe_questions"] if len(ctx.questions) < 3 else [],
    )
