from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from candor_evals import pipeline_adapter
from candor_evals.models import GroundTruth, RunOptions
from candor_evals.pipeline_adapter import RealPipelineAdapter, missing_credentials
from candor_evals.privacy_adapter import NodePrivacyAdapter, PrivacyError
from candor_evals.runner import execute
from candor_pipeline.contracts import AnalysisPayload

from tests.fakes import FakePipeline, FakePrivacy


async def test_privacy_missing_cli_fails_loudly(
    tmp_path: Path, scenario: Path, truth: GroundTruth
) -> None:
    with pytest.raises(PrivacyError, match="Privacy CLI unavailable"):
        await NodePrivacyAdapter(tmp_path).scrub(scenario, truth)


async def test_node_exact_cli_contract_and_validation(
    tmp_path: Path, scenario: Path, truth: GroundTruth
) -> None:
    fake = await FakePrivacy().scrub(scenario, truth)
    fixture = tmp_path / "fixture.json"
    fixture.write_text(fake.model_dump_json(), encoding="utf-8")
    script = tmp_path / "cli.mjs"
    script.write_text(
        'import {readFileSync,writeFileSync} from "node:fs";\n'
        "const args = process.argv.slice(2);\n"
        'if(args[0]!=="scrub" || args[1]!=="--dir" || args[3]!=="--self-terms" '
        '|| args[5]!=="--out" || !Array.isArray(JSON.parse(args[4]))) process.exit(2);\n'
        f"writeFileSync(args[6],readFileSync({json.dumps(str(fixture))}));\n",
        encoding="utf-8",
    )
    adapter = NodePrivacyAdapter(tmp_path)
    adapter.cli = script
    first = await adapter.scrub(scenario, truth)
    second = await adapter.scrub(scenario, truth)
    assert first.payload.report_id == second.payload.report_id
    assert first.payload.documents == fake.payload.documents


async def test_node_errors_never_echo_evidence(
    tmp_path: Path, scenario: Path, truth: GroundTruth, capfd: pytest.CaptureFixture[str]
) -> None:
    script = tmp_path / "bad.mjs"
    script.write_text('process.stderr.write("PRIVATE MARKER"); process.exit(2);', encoding="utf-8")
    adapter = NodePrivacyAdapter(tmp_path)
    adapter.cli = script
    with pytest.raises(PrivacyError, match="exit status 2"):
        await adapter.scrub(scenario, truth)
    assert "PRIVATE MARKER" not in str(capfd.readouterr())


async def test_node_invalid_output_safe_error(
    tmp_path: Path, scenario: Path, truth: GroundTruth
) -> None:
    script = tmp_path / "invalid.mjs"
    script.write_text(
        'import {writeFileSync} from "node:fs"; '
        'writeFileSync(process.argv.at(-1), "PRIVATE MARKER");',
        encoding="utf-8",
    )
    adapter = NodePrivacyAdapter(tmp_path)
    adapter.cli = script
    with pytest.raises(PrivacyError, match="invalid output") as error:
        await adapter.scrub(scenario, truth)
    assert "PRIVATE MARKER" not in str(error.value)


async def test_node_timeout(tmp_path: Path, scenario: Path, truth: GroundTruth) -> None:
    script = tmp_path / "wait.mjs"
    script.write_text("setInterval(() => {}, 1000);", encoding="utf-8")
    adapter = NodePrivacyAdapter(tmp_path, timeout=0.1)
    adapter.cli = script
    with pytest.raises(TimeoutError):
        await adapter.scrub(scenario, truth)


async def test_pipeline_public_boundary_and_stable_nonce(
    tmp_path: Path, scenario: Path, truth: GroundTruth, monkeypatch: pytest.MonkeyPatch
) -> None:
    privacy = FakePrivacy()
    scrubbed = await privacy.scrub(scenario, truth)
    expected = await FakePipeline(privacy).run(scrubbed.payload, RunOptions())
    nonces = []
    wrappers = []

    class Wrapper:
        def __init__(self, wrapped: object = None, **kwargs: Any) -> None:
            wrappers.append(kwargs)
            self.requests = [SimpleNamespace(system="Synthetic system", user="Synthetic request")]

    class Runner:
        def __init__(self, **kwargs: Any) -> None:
            assert kwargs["config"].samples == 3

        async def run(self, payload: AnalysisPayload, nonce: str) -> object:
            nonces.append(nonce)
            return expected.result

    modules = {
        "dag": SimpleNamespace(DAGRunner=Runner, PipelineConfig=SimpleNamespace),
        "registry": SimpleNamespace(build_provider=lambda spec: object()),
        "tap": SimpleNamespace(TapProvider=Wrapper),
        "chaos": SimpleNamespace(ChaosProvider=Wrapper),
        "replay": SimpleNamespace(ReplayProvider=Wrapper),
    }
    monkeypatch.setattr(
        pipeline_adapter.importlib, "import_module", lambda name: modules[name.split(".")[-1]]
    )
    adapter = RealPipelineAdapter(tmp_path)
    options = RunOptions(provider="meta:synthetic", record=True, chaos=0.3)
    first = await adapter.run(scrubbed.payload, options)
    second = await adapter.run(scrubbed.payload, options)
    assert first.result == second.result
    assert nonces[0] == nonces[1]
    assert len(nonces[0]) == 32
    assert first.prompts == ["Synthetic system\nSynthetic request"]
    assert any(item.get("synthetic") is True and item.get("mode") == "record" for item in wrappers)
    assert any(item.get("p") == 0.3 for item in wrappers)


@pytest.mark.parametrize(
    ("provider", "key"),
    [
        ("meta", "MODEL_API_KEY"),
        ("fireworks:model", "FIREWORKS_API_KEY"),
        ("baseten:model", "BASETEN_API_KEY"),
    ],
)
def test_missing_credentials(provider: str, key: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(key, raising=False)
    assert missing_credentials(provider) == f"{key} is not configured"
    monkeypatch.setenv(key, "synthetic-test-value")
    assert missing_credentials(provider) is None


def test_missing_model_and_unknown_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FIREWORKS_API_KEY", "synthetic-test-value")
    monkeypatch.delenv("CANDOR_FIREWORKS_MODEL", raising=False)
    assert missing_credentials("fireworks") == "Model is not configured"
    assert missing_credentials("unknown") == "Unknown provider"


async def test_cancellation_is_not_converted_to_failure(scenario: Path, truth: GroundTruth) -> None:
    class Cancelled:
        async def run(self, payload: AnalysisPayload, options: RunOptions) -> None:
            raise asyncio.CancelledError

    scrubbed = await FakePrivacy().scrub(scenario, truth)
    with pytest.raises(asyncio.CancelledError):
        await execute(Cancelled(), scrubbed.payload, RunOptions())
