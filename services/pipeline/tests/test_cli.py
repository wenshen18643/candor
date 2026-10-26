import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from candor_pipeline.cli import app
from tests.helpers import FIXTURE, NONCE, FakeProvider


def test_cli_synthetic_run_and_metrics(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr("candor_pipeline.cli.build_provider", lambda spec: FakeProvider())
    output = tmp_path / "result.json"
    result = CliRunner().invoke(
        app,
        [
            "run",
            str(FIXTURE),
            "--provider",
            "replay",
            "--output",
            str(output),
            "--synthetic",
            "--nonce",
            NONCE,
        ],
    )
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["citations_verified"] == 1
    assert "PERSON_1" not in result.output
    assert json.loads(output.read_text())["claims"][0]["citations"][0]["quote_verified"]


def test_cli_denies_unmarked_plaintext_output(tmp_path: Path) -> None:
    output = tmp_path / "result.json"
    result = CliRunner().invoke(app, ["run", str(FIXTURE), "--output", str(output)])
    assert result.exit_code == 1
    assert result.output.strip() == '{"event":"analysis_failed"}'
    assert not output.exists()


def test_health() -> None:
    result = CliRunner().invoke(app, ["health"])
    assert result.exit_code == 0
    assert json.loads(result.output)["status"] == "ok"
