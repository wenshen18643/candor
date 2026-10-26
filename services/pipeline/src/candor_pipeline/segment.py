import hashlib
import re

from candor_pipeline.contracts import AnalysisPayload, Passage


def segment_text(text: str, doc_id: str, minimum: int = 300, maximum: int = 900) -> list[Passage]:
    spans: list[tuple[int, int]] = []
    for paragraph in re.finditer(r"\S.*?(?=\n[ \t]*\n|\Z)", text, re.DOTALL):
        start, end = paragraph.span()
        sentences = list(re.finditer(r".*?(?:[.!?](?=\s|$)|$)", text[start:end], re.DOTALL))
        window_start = start
        window_end = start
        for sentence in sentences:
            if not sentence.group().strip():
                continue
            sentence_end = start + sentence.end()
            if window_end > window_start and sentence_end - window_start > maximum:
                spans.append((window_start, window_end))
                window_start = window_end
            window_end = sentence_end
            if window_end - window_start >= minimum:
                spans.append((window_start, window_end))
                window_start = window_end
        if window_end > window_start:
            spans.append((window_start, window_end))
    passages: list[Passage] = []
    for raw_start, raw_end in spans:
        start, end = raw_start, raw_end
        while start < end and text[start].isspace():
            start += 1
        while end > start and text[end - 1].isspace():
            end -= 1
        if start == end:
            continue
        content = text[start:end]
        ordinal = len(passages) + 1
        passages.append(
            Passage(
                passage_id=f"{doc_id}.P{ordinal:03d}",
                doc_id=doc_id,
                ordinal=ordinal,
                text=content,
                char_start=start,
                char_end=end,
                sha256=hashlib.sha256(content.encode()).hexdigest(),
            )
        )
    return passages


def segment_payload(payload: AnalysisPayload) -> list[Passage]:
    ids = [document.doc_id for document in payload.documents]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate_document_id")
    passages = [
        passage
        for document in payload.documents
        for passage in segment_text(document.text, document.doc_id)
    ]
    return passages + segment_text(payload.reporter_statement, "S")
