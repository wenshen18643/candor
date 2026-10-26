from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import candor_api.app as api_module
import modal
import pytest
from candor_api.settings import Settings
from fastapi.testclient import TestClient
from pydantic import ValidationError


@pytest.fixture(scope="module")
def deployment() -> ModuleType:
    path = Path(__file__).resolve().parents[1] / "modal/app.py"
    spec = importlib.util.spec_from_file_location("candor_modal_test", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_app_constructs_without_credentials(deployment: ModuleType) -> None:
    assert deployment.app.name == "candor"
    for name in ("api", "identity", "run_analysis", "run_evals"):
        assert isinstance(getattr(deployment, name), modal.Function)


def test_worker_calls_existing_cli_without_job_argument(
    deployment: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CANDOR_ENCLAVE_SK", "test-only-sentinel")
    monkeypatch.setenv("CANDOR_WORKER_TOKEN", "test-only-worker")
    monkeypatch.setenv("CANDOR_LLM_PROVIDER", "replay")
    execute = Mock()
    monkeypatch.setattr(deployment, "run_private", execute)
    deployment.run_analysis.local()
    command, env, timeout = execute.call_args.args
    assert command == ["/opt/candor/services/pipeline/.venv/bin/candor-worker", "--once"]
    assert env["CANDOR_LLM_PROVIDER"] == "replay"
    assert timeout < 1800


def test_worker_rejects_missing_key_before_launch(
    deployment: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("CANDOR_ENCLAVE_SK", raising=False)
    execute = Mock()
    monkeypatch.setattr(deployment, "run_private", execute)
    with pytest.raises(RuntimeError, match="Worker requires"):
        deployment.run_analysis.local()
    execute.assert_not_called()


def test_private_process_discards_payload_output(
    deployment: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    execute = Mock(return_value=SimpleNamespace(returncode=9))
    monkeypatch.setattr(deployment.subprocess, "run", execute)
    with pytest.raises(RuntimeError, match="status 9"):
        deployment.run_private(["worker"], {}, 12)
    assert execute.call_args.kwargs["stdout"] == subprocess.DEVNULL
    assert execute.call_args.kwargs["stderr"] == subprocess.DEVNULL
    assert execute.call_args.kwargs["timeout"] == 12


def test_identity_starts_built_service_with_private_database(
    deployment: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CANDOR_ENCLAVE_SK", "test-only-sentinel")
    execute = Mock()
    monkeypatch.setattr(deployment.subprocess, "Popen", execute)
    deployment.identity.local()
    assert execute.call_args.args[0] == [
        "node",
        "/opt/candor/services/identity/dist/main.js",
    ]
    env = execute.call_args.kwargs["env"]
    assert env["PORT"] == "8787"
    assert env["CANDOR_DATA_DIR"] == "/data"
    assert "CANDOR_ENCLAVE_SK" not in env


def test_evals_writes_unique_volume_directory_and_commits(
    deployment: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    execute = Mock()
    commit = Mock()
    monkeypatch.setattr(deployment, "run_private", execute)
    monkeypatch.setattr(deployment, "eval_data", SimpleNamespace(commit=commit))
    run_id = deployment.run_evals.local("replay")
    assert str(UUID(run_id)) == run_id
    command = execute.call_args.args[0]
    assert command[2:4] == ["--provider", "replay"]
    assert command[-1] == "--no-publish"
    assert command[-2] == f"/opt/candor/services/evals/results/{run_id}"
    commit.assert_called_once()


def test_evals_commits_failure_metrics_and_validates_provider(
    deployment: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    execute = Mock(side_effect=RuntimeError("failed"))
    commit = Mock()
    monkeypatch.setattr(deployment, "run_private", execute)
    monkeypatch.setattr(deployment, "eval_data", SimpleNamespace(commit=commit))
    with pytest.raises(ValidationError):
        deployment.run_evals.local("unknown")
    execute.assert_not_called()
    with pytest.raises(RuntimeError, match="failed"):
        deployment.run_evals.local()
    commit.assert_called_once()


def test_api_uses_actual_factory_and_commits_after_lifespan(
    deployment: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    tmp_path = Path(__file__).resolve().parents[1] / ".artifacts" / str(uuid4())
    tmp_path.mkdir(parents=True)
    application = api_module.create_app(Settings(candor_data_dir=tmp_path))
    monkeypatch.setattr(api_module, "create_app", lambda: application)
    commit = AsyncMock()
    monkeypatch.setattr(deployment, "data", SimpleNamespace(commit=SimpleNamespace(aio=commit)))
    monkeypatch.setenv("CANDOR_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MODAL_ENABLED", "false")
    monkeypatch.setenv("CANDOR_ENCLAVE_SK", "test-only-sentinel")
    with TestClient(deployment.api.local()) as client:
        assert client.get("/v1/health").status_code == 200
    commit.assert_awaited_once()
