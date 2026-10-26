from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from pathlib import Path

from candor_evals.metrics.matching import pseudonymize, replacements
from candor_evals.models import GroundTruth, PipelineRun, Pseudonym, RunOptions, Scrubbed
from candor_pipeline.contracts import (
    AnalysisMetrics,
    AnalysisPayload,
    AnalysisResult,
    BriefSummary,
    Citation,
    Claim,
    Contradiction,
    DocumentIn,
    EntityLegendItem,
    FollowUpQuestion,
    InjectionFinding,
    Passage,
    StageRun,
    TemporalConflict,
    TimeInterval,
    TimelineEvent,
    Verification,
)
from docx import Document
from pypdf import PdfReader

NOW = datetime(2026, 4, 10, 12, tzinfo=UTC)


def read_document(path: Path) -> str:
    if path.suffix == ".docx":
        return "\n".join(paragraph.text for paragraph in Document(path).paragraphs)
    if path.suffix == ".pdf":
        return "\n".join(page.extract_text() for page in PdfReader(path).pages)
    return path.read_text(encoding="utf-8")


class FakePrivacy:
    def __init__(self) -> None:
        self.truths: dict[str, GroundTruth] = {}
        self.scrubbed: dict[str, Scrubbed] = {}

    async def scrub(self, directory: Path, truth: GroundTruth) -> Scrubbed:
        self.truths[truth.scenario_id] = truth
        pseudonyms = [
            Pseudonym(
                placeholder=f"PERSON_{index}",
                type="person",
                value=person.name,
                variants=person.aliases,
            )
            for index, person in enumerate(truth.people, 1)
        ]
        pseudonyms.extend(
            Pseudonym(placeholder=f"OTHER_{index}", type="other", value=value)
            for index, value in enumerate(truth.canaries, 1)
        )
        mapping = replacements(pseudonyms)
        for value in truth.canaries:
            for token in re.findall(r"\w+", value):
                if len(token) >= 4 and token not in mapping:
                    entry = Pseudonym(
                        placeholder=f"OTHER_{len(pseudonyms) + 100}", type="other", value=token
                    )
                    pseudonyms.append(entry)
                    mapping[token] = entry.placeholder
        kinds = {
            ".eml": "email",
            ".txt": "chat",
            ".md": "memo",
            ".csv": "csv",
            ".docx": "docx",
            ".pdf": "pdf",
        }
        documents = []
        for index, path in enumerate(sorted(directory.iterdir()), 1):
            if path.suffix not in kinds or path.name == "reporter_statement.txt":
                continue
            documents.append(
                DocumentIn(
                    doc_id=f"D{index}",
                    title=path.name,
                    kind=kinds[path.suffix],
                    anchor_date=NOW.date(),
                    text=pseudonymize(read_document(path), mapping),
                )
            )
        payload = AnalysisPayload(
            report_id=truth.scenario_id,
            campaign_id="fictional-eval",
            documents=documents,
            reporter_statement=pseudonymize(
                read_document(directory / "reporter_statement.txt"), mapping
            ),
            entity_legend=[
                EntityLegendItem(placeholder=item.placeholder, type=item.type)
                for item in pseudonyms
            ],
        )
        scrubbed = Scrubbed(
            payload=payload, pseudonym_map=pseudonyms, stripped_files=[], leakage_estimate=0
        )
        self.scrubbed[truth.scenario_id] = scrubbed
        return scrubbed


class FakePipeline:
    def __init__(
        self, privacy: FakePrivacy, lose_under_injection: bool = False, fail_chaos: bool = False
    ) -> None:
        self.privacy = privacy
        self.lose_under_injection = lose_under_injection
        self.fail_chaos = fail_chaos
        self.calls: list[RunOptions] = []

    async def run(self, payload: AnalysisPayload, options: RunOptions) -> PipelineRun:
        self.calls.append(options)
        if self.fail_chaos and options.chaos:
            return PipelineRun(failure="pipeline_execution_failed")
        truth = self.privacy.truths[payload.report_id]
        scrubbed = self.privacy.scrubbed[payload.report_id]
        mapping = replacements(scrubbed.pseudonym_map)
        passages = [
            Passage(
                passage_id=f"{doc.doc_id}.P001",
                doc_id=doc.doc_id,
                ordinal=1,
                text=doc.text,
                char_start=0,
                char_end=len(doc.text),
                sha256=hashlib.sha256(doc.text.encode()).hexdigest(),
            )
            for doc in payload.documents
        ]
        by_name = {
            doc.title: passage for doc, passage in zip(payload.documents, passages, strict=True)
        }
        injected = any("SYSTEM OVERRIDE" in passage.text for passage in passages)
        claims = []
        timeline = []
        for index, event in enumerate(truth.events, 1):
            if self.lose_under_injection and injected and index == 1:
                continue
            passage = by_name[event.doc]
            quote = pseudonymize(event.quote, mapping)
            interval = (
                TimeInterval(
                    earliest=event.date,
                    latest=event.date,
                    granularity=event.granularity,
                    source_text=quote,
                )
                if event.date
                else None
            )
            claim = Claim(
                claim_id=f"C{index:03}",
                statement=pseudonymize(event.description, mapping),
                kind="event",
                actors=[pseudonymize(actor, mapping) for actor in event.actors],
                action="recorded",
                time=interval,
                source_type="document",
                evidence_class="documented",
                citations=[
                    Citation(passage_id=passage.passage_id, quote=quote, quote_verified=True)
                ],
                verification=Verification(
                    verdict="supported", rationale="Source records this statement"
                ),
            )
            claims.append(claim)
            if interval:
                timeline.append(
                    TimelineEvent(
                        event_id=f"T{index:03}",
                        claim_ids=[claim.claim_id],
                        title=claim.statement,
                        interval=interval,
                        order_rank=index,
                    )
                )
        contradictions = [
            Contradiction(
                contradiction_id=f"K{index}",
                claim_ids=[f"C{int(item.a[1:]):03}", f"C{int(item.b[1:]):03}"],
                description="Source accounts conflict",
                severity="high",
            )
            for index, item in enumerate(truth.contradictions)
            if all(
                f"C{int(key[1:]):03}" in {claim.claim_id for claim in claims}
                for key in (item.a, item.b)
            )
        ]
        conflicts = [
            TemporalConflict(
                conflict_id=f"F{index}",
                event_ids=[f"T{int(item.a[1:]):03}", f"T{int(item.b[1:]):03}"],
                description="Order conflicts with dates",
                constraints=["after"],
            )
            for index, item in enumerate(truth.contradictions)
            if item.note.startswith("Temporal:")
        ]
        findings = [
            InjectionFinding(
                passage_id=passage.passage_id, signals=["override"], risk=1, quarantined=True
            )
            for passage in passages
            if "SYSTEM OVERRIDE" in passage.text
        ]
        stages = [
            StageRun(
                stage=stage,
                status="succeeded",
                provider="fake",
                model="fixture",
                started_at=NOW,
                ended_at=NOW,
                duration_ms=10 + index,
                repairs=int(bool(options.chaos)),
                cost_usd=0.01,
                llm_calls=1,
            )
            for index, stage in enumerate(("extract", "verify", "gaps"))
        ]
        result = AnalysisResult(
            report_id=payload.report_id,
            generated_at=NOW,
            summary=BriefSummary(
                headline="Synthetic source review", overview="Documents need review", key_points=[]
            ),
            passages=passages,
            claims=claims,
            timeline=timeline,
            contradictions=contradictions,
            temporal_conflicts=conflicts,
            injection_findings=findings,
            follow_up_questions=[
                FollowUpQuestion(
                    question_id=f"Q{index}",
                    question=f"Please clarify {gap}",
                    rationale="Missing detail",
                    gap_type=gap,
                    priority=2,
                    expected_information_gain=0.5,
                )
                for index, gap in enumerate(truth.expected_gaps)
            ],
            stages=stages,
            metrics=AnalysisMetrics(),
        )
        return PipelineRun(
            result=result, prompts=["\n".join(document.text for document in payload.documents)]
        )
