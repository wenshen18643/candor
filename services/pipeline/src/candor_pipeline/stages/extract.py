import asyncio

from candor_pipeline.providers.base import ProviderError
from candor_pipeline.stages.context import PipelineContext, StageOutput
from candor_pipeline.stages.models import Extraction
from candor_pipeline.structured import validate_references


async def run(ctx: PipelineContext) -> StageOutput:
    passage_ids = {passage.passage_id for passage in ctx.passages}

    def validate(output: Extraction) -> None:
        ids = {claim.claim_id for claim in output.claims}
        if len(ids) != len(output.claims):
            raise ValueError("duplicate_claim_id")
        validate_references(output.model_dump(), passage_ids, ids)
        for claim in output.claims:
            if not claim.citations or any(
                not cite.quote.strip() or len(cite.quote.split()) > 40 for cite in claim.citations
            ):
                raise ValueError("invalid_quote")

    tasks = [
        asyncio.create_task(
            ctx.ask(
                "extract",
                Extraction,
                context={
                    "entity_legend": [entity.model_dump() for entity in ctx.payload.entity_legend]
                },
                sample=sample,
                semantic=validate,
            )
        )
        for sample in range(ctx.config.samples)
    ]
    try:
        results = await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    failures = [result for result in results if isinstance(result, BaseException)]
    outputs = [None if isinstance(result, BaseException) else result for result in results]
    if all(output is None for output in outputs):
        if failures and isinstance(failures[0], ProviderError):
            raise failures[0]
        raise ProviderError("extraction_invalid")
    ctx.samples = [output.claims if output else [] for output in outputs]
    for sample in ctx.samples:
        for claim in sample:
            documents = {citation.passage_id.split(".")[0] for citation in claim.citations}
            claim.source_type = (
                "reporter_statement"
                if documents == {"S"}
                else "mixed"
                if "S" in documents
                else "document"
            )
            for citation in claim.citations:
                citation.quote_verified = False
                citation.match_start = citation.match_end = None
    if failures:
        return StageOutput(degraded=True, notes=[f"samples_lost:{len(failures)}"])
    return StageOutput()
