from candor_pipeline.segment import segment_payload
from candor_pipeline.stages.context import PipelineContext, StageOutput


async def run(ctx: PipelineContext) -> StageOutput:
    ctx.passages = segment_payload(ctx.payload)
    return StageOutput()
