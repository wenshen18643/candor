from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
from candor_pipeline.contracts import Claim
from rapidfuzz.fuzz import token_set_ratio
from scipy.optimize import linear_sum_assignment

from candor_evals.models import GroundTruth, Pseudonym, TruthEvent


@dataclass(frozen=True)
class Match:
    claim_index: int
    event_index: int
    similarity: float


def replacements(pseudonyms: list[Pseudonym]) -> dict[str, str]:
    return {
        value: item.placeholder
        for item in pseudonyms
        for value in [item.value, *item.variants]
        if value
    }


def pseudonymize(text: str, mapping: dict[str, str]) -> str:
    if not mapping:
        return text
    lookup = {key.casefold(): value for key, value in mapping.items()}
    expression = "|".join(re.escape(key) for key in sorted(mapping, key=len, reverse=True))
    return re.sub(
        r"(?<!\w)(?:" + expression + r")(?!\w)",
        lambda match: lookup[match.group().casefold()],
        text,
        flags=re.IGNORECASE,
    )


def similarity(claim: Claim, event: TruthEvent, mapping: dict[str, str]) -> float:
    text_score = (
        token_set_ratio(
            claim.statement.casefold(), pseudonymize(event.description, mapping).casefold()
        )
        / 100
    )
    actual = {actor.casefold() for actor in claim.actors}
    expected = {pseudonymize(actor, mapping).casefold() for actor in event.actors}
    overlap = len(actual & expected) / len(actual | expected) if actual | expected else 0
    return 0.8 * text_score + 0.2 * overlap


def match_claims(
    claims: list[Claim], truth: GroundTruth, pseudonyms: list[Pseudonym], threshold: float = 0.55
) -> list[Match]:
    if not 0 <= threshold <= 1:
        raise ValueError("Matching threshold must be between zero and one")
    if not claims or not truth.events:
        return []
    mapping = replacements(pseudonyms)
    scores = np.array(
        [[similarity(claim, event, mapping) for event in truth.events] for claim in claims]
    )
    reward = np.where(scores >= threshold, scores, 0.0)
    rows, columns = linear_sum_assignment(reward, maximize=True)
    return [
        Match(int(row), int(column), float(scores[row, column]))
        for row, column in zip(rows, columns, strict=True)
        if scores[row, column] >= threshold
    ]
