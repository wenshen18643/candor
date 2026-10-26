import hashlib

import pytest

from candor_pipeline.contracts import Citation
from candor_pipeline.router import Router
from candor_pipeline.segment import segment_payload, segment_text
from candor_pipeline.stages.consolidate import run as consolidate
from candor_pipeline.stages.context import PipelineContext
from candor_pipeline.stages.ground import ground_citation, normalized_offsets, run
from tests.helpers import FakeProvider, payload, raw_claim


def test_segment_offsets_hash_stability() -> None:
    text = "  First paragraph.\n\nSecond paragraph has two sentences. Another sentence.  "
    passages = segment_text(text, "D4")
    assert [item.passage_id for item in passages] == ["D4.P001", "D4.P002"]
    for item in passages:
        assert item.text == text[item.char_start : item.char_end]
        assert item.sha256 == hashlib.sha256(item.text.encode()).hexdigest()
    assert passages == segment_text(text, "D4")


def test_sentence_windows_never_split_sentences() -> None:
    sentence = "A" * 200 + ". "
    passages = segment_text(sentence * 10, "D1")
    assert all(300 <= len(item.text) <= 900 for item in passages)
    assert all(item.text.endswith(".") for item in passages)
    assert len(segment_text("X" * 1200, "D1")) == 1
    assert segment_text(" \n\n", "D1") == []


def test_statement_and_duplicate_ids() -> None:
    data = payload()
    assert segment_payload(data)[-1].passage_id == "S.P001"
    data.documents.append(data.documents[0])
    with pytest.raises(ValueError, match="duplicate_document_id"):
        segment_payload(data)


@pytest.mark.parametrize(
    ("text", "quote", "verified"),
    [
        ("He said “review”—then left.", 'He said "review"-then left.', True),
        ("a   b\n c", "a b c", True),
        ("The review memo was received yesterday.", "The review memo was receivd yesterday.", True),
        ("The review memo was received yesterday.", "The review memo was never received.", False),
        ("Quoted text.", "", False),
        ("a b", "a " * 41, False),
    ],
)
def test_grounding(text: str, quote: str, verified: bool) -> None:
    passage = segment_text(text, "D1")[0]
    citation = Citation(passage_id=passage.passage_id, quote=quote, quote_verified=True)
    ground_citation(citation, passage)
    assert citation.quote_verified is verified
    if verified:
        assert citation.match_start is not None
        assert citation.match_end is not None
        assert 0 <= citation.match_start < citation.match_end <= len(text)
    else:
        assert citation.match_start is None


def test_normalized_offsets_unicode() -> None:
    text, offsets = normalized_offsets("  A\t\tﬁle  ")
    assert text == "A file"
    assert offsets == [2, 3, 5, 5, 6, 7]


async def test_ground_drops_unknown_passages() -> None:
    ctx = PipelineContext(payload(), Router(FakeProvider()))
    ctx.samples = [[raw_claim(citations=[{"passage_id": "D99.P001", "quote": "missing"}])]]
    await consolidate(ctx)
    await run(ctx)
    assert ctx.claims[0].citations == []
    assert set(ctx.claims[0].flags) == {"invalid_citation", "unverified_quote"}
