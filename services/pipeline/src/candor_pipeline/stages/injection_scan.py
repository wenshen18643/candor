import re

from candor_pipeline.contracts import InjectionFinding
from candor_pipeline.stages.context import PipelineContext, StageOutput
from candor_pipeline.stages.models import InjectionOutput

PATTERNS = {
    "override": (
        r"(?:ignore|disregard|override|forget)\b.{0,60}\b(?:instruction|previous|above|rules)"
    ),
    "role_switch": r"(?:you are now|act as|system\s*:|<\|(?:system|assistant)\|>)",
    "system_reference": r"(?:system prompt|developer message|hidden instructions)",
    "output_manipulation": r"(?:output|return|respond|print)\b.{0,40}(?:only|instead|json|verdict)",
    "exfiltration": r"(?:send|upload|post|curl|fetch)\b.{0,100}(?:https?://|token|secret|key)",
    "hidden_text": r"(?:display\s*:\s*none|font-size\s*:\s*0|\u200b|\u202e|<!--)",
}


def scan(text: str) -> tuple[list[str], float]:
    signals = [name for name, pattern in PATTERNS.items() if re.search(pattern, text, re.I | re.S)]
    risk = min(1.0, 0.4 * len(signals))
    if any(signal in signals for signal in ("override", "exfiltration", "role_switch")):
        risk = max(risk, 0.8)
    return signals, risk


async def run(ctx: PipelineContext) -> StageOutput:
    candidates = []
    for passage in ctx.passages:
        passage.injection_signals, passage.injection_risk = scan(passage.text)
        if passage.injection_signals or re.search(
            r"\byou\s+(?:must|should|will|need)\b", passage.text, re.I
        ):
            candidates.append(passage)
    if candidates:
        output = await ctx.ask("injection_scan", InjectionOutput, candidates)
        if output:
            refined = {finding.passage_id: finding for finding in output.findings}
            for passage in candidates:
                if passage.passage_id in refined:
                    finding = refined[passage.passage_id]
                    passage.injection_risk = max(passage.injection_risk, finding.risk)
                    passage.injection_signals = sorted(
                        set(passage.injection_signals + finding.signals)
                    )
    ctx.injection_findings = [
        InjectionFinding(
            passage_id=passage.passage_id,
            signals=passage.injection_signals,
            risk=passage.injection_risk,
            quarantined=passage.injection_risk >= ctx.config.quarantine_threshold,
        )
        for passage in ctx.passages
        if passage.injection_risk > 0
    ]
    return StageOutput()
