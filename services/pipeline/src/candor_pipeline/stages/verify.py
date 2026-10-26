from candor_pipeline.contracts import Verification
from candor_pipeline.providers.base import ProviderError
from candor_pipeline.stages.context import PipelineContext, StageOutput
from candor_pipeline.stages.models import VerificationOutput


async def run(ctx: PipelineContext) -> StageOutput:
    passages = {passage.passage_id: passage for passage in ctx.passages}
    lost = 0
    for start in range(0, len(ctx.claims), ctx.config.batch_size):
        batch = ctx.claims[start : start + ctx.config.batch_size]
        allowed = {
            claim.claim_id: {
                cite.passage_id
                for cite in claim.citations
                if cite.quote_verified
                and (
                    claim.source_type != "reporter_statement"
                    or passages[cite.passage_id].doc_id != "S"
                )
            }
            for claim in batch
        }
        selected = [passages[key] for key in sorted(set().union(*allowed.values()))]

        def validate(output: VerificationOutput, permitted: dict[str, set[str]] = allowed) -> None:
            ids = [item.claim_id for item in output.verifications]
            if set(ids) != set(permitted) or len(ids) != len(set(ids)):
                raise ValueError("verification_coverage")
            for item in output.verifications:
                if not set(item.verification.checked_passages) <= permitted[item.claim_id]:
                    raise ValueError("uncited_verification")

        output = None
        for attempt in range(ctx.config.retries + 1):
            try:
                output = await ctx.ask(
                    "verify",
                    VerificationOutput,
                    selected,
                    context={
                        "claims": [
                            {
                                "claim_id": claim.claim_id,
                                "statement": claim.statement,
                                "source_type": claim.source_type,
                                "allowed_passages": sorted(allowed[claim.claim_id]),
                            }
                            for claim in batch
                        ]
                    },
                    semantic=validate,
                    sample=start // ctx.config.batch_size,
                )
                break
            except ProviderError as error:
                if not error.retryable or attempt == ctx.config.retries:
                    lost += 1
                    break
        results = (
            {item.claim_id: item.verification for item in output.verifications} if output else {}
        )
        for claim in batch:
            verification = results.get(claim.claim_id)
            if not allowed[claim.claim_id] or verification is None:
                verification = Verification(
                    verdict="unverifiable",
                    rationale="No verified document support is available for this assessment.",
                )
            elif not verification.checked_passages:
                verification = Verification(
                    verdict="unverifiable",
                    rationale="The verifier did not identify supporting passages.",
                )
            stats = ctx.stats.get("verify")
            if stats and stats.responses:
                verification.verifier_model = stats.responses[-1].model
            claim.verification = verification
    if lost:
        return StageOutput(degraded=True, notes=[f"verifier_batches_unavailable:{lost}"])
    return StageOutput()
