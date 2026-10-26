import re
import unicodedata

from rapidfuzz.fuzz import ratio

from candor_pipeline.contracts import Citation, Passage
from candor_pipeline.stages.context import PipelineContext, StageOutput

TRANSLATIONS = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'", "–": "-", "—": "-"})


def normalized_offsets(text: str) -> tuple[str, list[int]]:
    chars: list[str] = []
    offsets: list[int] = []
    for index, character in enumerate(text):
        for normalized in unicodedata.normalize("NFKC", character).translate(TRANSLATIONS):
            if normalized.isspace() and (not chars or chars[-1] == " "):
                continue
            chars.append(" " if normalized.isspace() else normalized)
            offsets.append(index)
    if chars and chars[-1] == " ":
        chars.pop()
        offsets.pop()
    return "".join(chars), offsets


def ground_citation(citation: Citation, passage: Passage) -> None:
    citation.quote_verified = False
    citation.match_start = citation.match_end = None
    quote, _ = normalized_offsets(citation.quote)
    text, offsets = normalized_offsets(passage.text)
    if not quote or len(quote.split()) > 40:
        return
    start = text.find(quote)
    end = start + len(quote)
    if start < 0 and len(quote) >= 20:
        best = (94.999, -1, -1)
        words = list(re.finditer(r"\S+", text))
        width = len(quote.split())
        for index, word in enumerate(words):
            for count in range(max(1, width - 1), width + 2):
                if index + count > len(words):
                    continue
                stop = words[index + count - 1].end()
                score = ratio(quote, text[word.start() : stop])
                if score > best[0]:
                    best = score, word.start(), stop
        _, start, end = best
    if start >= 0:
        citation.quote_verified = True
        citation.match_start = offsets[start]
        citation.match_end = offsets[end - 1] + 1


async def run(ctx: PipelineContext) -> StageOutput:
    passages = {passage.passage_id: passage for passage in ctx.passages}
    for claim in ctx.claims:
        valid = []
        for citation in claim.citations:
            if citation.passage_id not in passages:
                if "invalid_citation" not in claim.flags:
                    claim.flags.append("invalid_citation")
                continue
            ground_citation(citation, passages[citation.passage_id])
            valid.append(citation)
        claim.citations = valid
        if not any(citation.quote_verified for citation in valid):
            claim.flags.append("unverified_quote")
    return StageOutput()
