import re
from itertools import combinations

from candor_pipeline.contracts import Claim, Contradiction
from candor_pipeline.stages.context import PipelineContext, StageOutput
from candor_pipeline.stages.models import ContradictionsOutput


def candidate_pairs(claims: list[Claim], limit: int = 60) -> list[tuple[Claim, Claim]]:
    pairs = []
    for left, right in combinations(claims, 2):
        if not set(left.actors + left.targets) & set(right.actors + right.targets):
            continue
        overlap = (
            left.time is not None
            and right.time is not None
            and left.time.earliest <= right.time.latest
            and right.time.earliest <= left.time.latest
        )
        negations = r"\b(?:not|never|no|denied|refused|cancelled|rejected|without)\b"
        opposite = bool(re.search(negations, left.statement, re.I)) != bool(
            re.search(negations, right.statement, re.I)
        )
        if overlap or opposite:
            pairs.append((left, right))
        if len(pairs) >= limit:
            break
    return pairs


async def run(ctx: PipelineContext) -> StageOutput:
    pairs = candidate_pairs(ctx.claims)
    allowed = {frozenset((left.claim_id, right.claim_id)) for left, right in pairs}
    if pairs:
        output = await ctx.ask(
            "contradictions",
            ContradictionsOutput,
            context={
                "pairs": [
                    [left.model_dump(mode="json"), right.model_dump(mode="json")]
                    for left, right in pairs
                ]
            },
        )
        claims = {claim.claim_id: claim for claim in ctx.claims}
        for item in output.pairs if output else []:
            if item.label != "contradiction" or frozenset(item.claim_ids) not in allowed:
                continue
            citations = {
                cite.passage_id
                for claim_id in item.claim_ids
                for cite in claims[claim_id].citations
                if cite.quote_verified
            }
            if not item.passages or not set(item.passages) <= citations:
                continue
            ctx.contradictions.append(
                Contradiction(
                    contradiction_id=f"X{len(ctx.contradictions) + 1:03d}",
                    claim_ids=item.claim_ids,
                    description=item.description,
                    severity=item.severity,
                    passages=item.passages,
                )
            )
    for conflict in ctx.temporal_conflicts:
        claims = sorted(
            {
                claim_id
                for event in ctx.timeline
                if event.event_id in conflict.event_ids
                for claim_id in event.claim_ids
            }
        )
        if len(claims) >= 2:
            ctx.contradictions.append(
                Contradiction(
                    contradiction_id=f"X{len(ctx.contradictions) + 1:03d}",
                    claim_ids=claims,
                    description=conflict.description,
                    severity="medium",
                    passages=conflict.passages,
                )
            )
    return StageOutput()
