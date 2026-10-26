import csv
import hashlib
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile

from candor_evals.models import load_truth
from candor_evals.synth import generate
from docx import Document
from pypdf import PdfReader

from tests.fakes import read_document


def fingerprints(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.rglob("*")
        if path.is_file()
    }


def test_generator_byte_determinism(scenario_root: Path, tmp_path: Path) -> None:
    generate(tmp_path)
    assert fingerprints(tmp_path) == fingerprints(scenario_root)
    generate(tmp_path, seed=43)
    assert fingerprints(tmp_path) != fingerprints(scenario_root)


def test_all_ground_truth_quotes_are_verbatim(scenario_root: Path) -> None:
    for directory in scenario_root.iterdir():
        truth = load_truth(directory)
        for event in truth.events:
            assert event.quote in read_document(directory / event.doc), (
                truth.scenario_id,
                event.gt_id,
            )
        for attack in truth.injections:
            assert attack.text in read_document(directory / attack.doc)


def test_domains_counts_and_temporal_variety(scenario_root: Path) -> None:
    directories = list(scenario_root.iterdir())
    assert len(directories) == 6
    truths = [load_truth(path) for path in directories]
    assert sum(bool(truth.injections) for truth in truths) >= 3
    assert (
        sum(
            any(item.note.startswith("Temporal:") for item in truth.contradictions)
            for truth in truths
        )
        >= 2
    )
    for directory, truth in zip(directories, truths, strict=True):
        documents = [path for path in directory.iterdir() if path.name != "ground_truth.json"]
        assert len(documents) == 8
        assert {path.suffix for path in documents} == {
            ".eml",
            ".txt",
            ".md",
            ".csv",
            ".docx",
            ".pdf",
        }
        assert truth.reporter.email.endswith(".example")
        assert "555" in truth.reporter.phone
        assert any(event.date is None for event in truth.events)
        assert any(event.granularity == "month" for event in truth.events)
        for email in directory.glob("*.eml"):
            text = email.read_text(encoding="utf-8")
            assert all(
                header in text
                for header in ("Date:", "Message-ID:", "X-Originating-IP:", "From:", "Subject:")
            )


def test_ledger_totals(scenario_root: Path) -> None:
    for directory in scenario_root.iterdir():
        with (directory / "ledger_05.csv").open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream))
        assert sum(Decimal(row["amount_usd"]) for row in rows[:-1]) == Decimal(
            rows[-1]["amount_usd"]
        )


def test_binary_canary_metadata(scenario_root: Path) -> None:
    for directory in scenario_root.iterdir():
        truth = load_truth(directory)
        properties = Document(directory / "review_06.docx").core_properties
        assert properties.author == truth.reporter.name
        assert properties.last_modified_by == truth.reporter.email
        with ZipFile(directory / "review_06.docx") as archive:
            assert truth.reporter.name.encode() in archive.read("docProps/app.xml")
        metadata = PdfReader(directory / "receipt_07.pdf").metadata
        assert metadata.author == truth.reporter.name
        assert truth.reporter.email in metadata.creator
