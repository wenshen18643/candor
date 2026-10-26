from __future__ import annotations

import json
import re
from typing import Any

from candor_evals.models import PipelineRun, Scrubbed


def count_leaks(value: Any, canaries: list[str]) -> int:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    terms = {canary.casefold() for canary in canaries if canary}
    terms.update(
        token.casefold()
        for canary in canaries
        for token in re.findall(r"\w+", canary)
        if len(token) >= 4 and any(character.isdigit() for character in token)
    )
    folded = text.casefold()
    spans = sorted(
        {
            match.span()
            for term in terms
            for match in re.finditer(r"(?<!\w)" + re.escape(term) + r"(?!\w)", folded)
        }
    )
    count = 0
    end = -1
    for start, stop in spans:
        if start >= end:
            count += 1
        end = max(end, stop)
    return count


def leakage_metrics(
    scrubbed: Scrubbed, runs: list[PipelineRun], canaries: list[str]
) -> dict[str, int]:
    counts = {
        "analysis_payload": count_leaks(scrubbed.payload.model_dump(mode="json"), canaries),
        "outbound_prompts": sum(
            count_leaks(prompt, canaries) for run in runs for prompt in run.prompts
        ),
        "stripped_metadata": sum(
            count_leaks(item.metadata_after, canaries) for item in scrubbed.stripped_files
        ),
        "analysis_result": sum(
            count_leaks(run.result.model_dump(mode="json"), canaries)
            for run in runs
            if run.result is not None
        ),
    }
    return {**counts, "total": sum(counts.values()), "scenario_leaked": int(any(counts.values()))}
