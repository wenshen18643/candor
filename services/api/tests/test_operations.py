import json
import logging
import secrets
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from nacl.signing import SigningKey
from pydantic import ValidationError
from sqlalchemy import inspect, select
from typer.testing import CliRunner

from candor_api import tables as t
from candor_api.app import create_app
from candor_api.audit import AuditLog, validate_entry
from candor_api.cli import app
from candor_api.common import b64u, uid, unb64
from candor_api.database import transaction
from candor_api.integrations import IdentityClient, MockAnchor
from candor_api.middleware import SafeFormatter
from candor_api.runtime import Runtime
from candor_api.seed import seed
from candor_api.settings import Settings
from tests.conftest import Harness
from tests.helpers import seal


def test_no_payloads_in_log_entries_or_structured_logs(
    harness: Harness, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="candor.api")
    submission = harness.submission()
    response = harness.client.post("/v1/reports", json=submission)
    assert response.status_code == 201
    report_id = response.json()["report_id"]
    message = seal()
    headers = harness.login()
    harness.client.post(
        f"/v1/reports/{report_id}/messages",
        headers=headers,
        json={"box": message, "question_ids": []},
    )
    entries = harness.client.get("/v1/log/entries").json()
    serialized = json.dumps(entries)
    lines = "\n".join(
        record.getMessage() for record in caplog.records if record.name == "candor.api"
    )
    secrets_to_check = [
        submission["token"]["prepared"],
        submission["token"]["signature"],
        submission["manifest"]["c"],
        submission["analysis"]["sealed_key"],
        message["c"],
        headers["Authorization"].split()[1],
    ]
    for value in secrets_to_check:
        assert value not in serialized
        assert value not in lines
    assert entries[0]["created_at"] == entries[0]["entry"]["bucket"]
    for line in lines.splitlines():
        assert set(json.loads(line)) <= {"event", "method", "route", "status"}
    invalid = harness.client.post("/v1/reports", json={"body": "private evidence text"})
    assert invalid.status_code == 422
    assert "private evidence text" not in invalid.text
    record = logging.LogRecord("uvicorn.error", logging.ERROR, "", 0, "private payload", (), None)
    assert "private payload" not in SafeFormatter().format(record)
    with pytest.raises(ValueError, match="Invalid audit"):
        validate_entry(
            {
                "type": "message.sent",
                "report_id": report_id,
                "direction": "to_reporter",
                "body": "private",
            }
        )


def test_database_separation_and_api_has_no_issuer_private_key(harness: Harness) -> None:
    assert "candor_enclave_sk" not in Settings.model_fields
    assert {"reports", "jobs", "spent_tokens"} <= set(
        inspect(harness.runtime.engine).get_table_names()
    )
    assert set(inspect(harness.runtime.audit.engine).get_table_names()) == {
        "log_entries",
        "tree_heads",
        "anchors",
    }
    assert set(inspect(harness.runtime.payments.engine).get_table_names()) == {"payments"}
    assert all(
        "private" not in column.name
        for table in t.metadata.tables.values()
        for column in table.columns
    )
    assert set(
        json.loads((harness.runtime.settings.candor_data_dir / "demo/enclave.json").read_text())
    ) == {"key_id", "enc_pk"}


def test_restart_recovers_audit_outbox_once(harness: Harness) -> None:
    harness.submit()
    with transaction(harness.runtime.engine) as connection:
        event_id = harness.runtime.emit(
            connection, "message.sent", report_id=uid(), direction="to_reporter"
        )
    before = harness.runtime.audit.latest()["tree_size"]
    runtime = Runtime(harness.runtime.settings, harness.runtime.issuers)
    try:
        assert runtime.audit.latest()["tree_size"] == before + 1
        with transaction(runtime.engine) as connection:
            connection.execute(
                t.outbox.update().where(t.outbox.c.id == event_id).values(delivered=False)
            )
        runtime.flush_audit()
        assert runtime.audit.latest()["tree_size"] == before + 1
        assert len(runtime.audit.tree.leaves) == before + 1
    finally:
        runtime.close()


def test_automatic_anchors_and_wrong_signing_key(harness: Harness) -> None:
    harness.runtime.audit.every = 2
    harness.submit()
    report_id = harness.submit()
    assert harness.runtime.audit.list_anchors()[0]["tree_size"] == 2
    assert harness.runtime.audit.latest()["tree_size"] == 3
    with pytest.raises(Exception, match="Signature was forged or corrupt"):
        AuditLog(
            harness.runtime.settings.candor_audit_db_url, SigningKey.generate(), MockAnchor(), 16
        )
    assert report_id


def test_production_demo_endpoint_and_secret_validation(harness: Harness) -> None:
    with pytest.raises(ValidationError, match="strong configured secrets"):
        Settings(candor_mode="production")
    with pytest.raises(ValidationError, match="Databases must be separate"):
        Settings(
            candor_reports_db_url="sqlite:///same.db", candor_audit_db_url="sqlite:///./same.db"
        )
    assert harness.client.get("/v1/demo/identities").status_code == 200
    harness.runtime.settings.candor_mode = "production"
    assert harness.client.get("/v1/demo/identities").status_code == 404


def test_unavailable_identity_never_generates_local_rsa(harness: Harness) -> None:
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503))) as client:
        harness.runtime.issuers = IdentityClient(harness.runtime.settings, client)
        response = harness.client.get("/v1/campaigns/northwind-ethics")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "issuer_unavailable"
        with harness.runtime.engine.connect() as connection:
            assert connection.execute(select(t.campaigns.c.issuer_spki)).scalars().all() == ["", ""]


def test_seed_reset_keys_and_environment(harness: Harness) -> None:
    settings = harness.runtime.settings
    old_identity = harness.identities[0]["id"]
    harness.runtime.close()
    seed(
        settings,
        reset=True,
        warn=lambda message: None,
        client=httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503))),
    )
    identities = json.loads((settings.candor_data_dir / "demo/identities.json").read_text())
    assert identities[0]["id"] != old_identity
    assert [identity["name"] for identity in identities] == [
        "Avery Chen",
        "Morgan Ellis",
        "Riley Park",
    ]
    assert len(unb64(identities[0]["sig_sk"])) == 64
    assert len(unb64(identities[0]["enc_sk"])) == 32
    environment = (settings.candor_data_dir / "demo/.env.local").read_text()
    assert "CANDOR_ENCLAVE_SK=" in environment
    assert "CANDOR_PAYMENTS_LINK_KEY=" in environment


def test_cli_openapi_and_serve_hook(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(app, ["openapi"])
    assert result.exit_code == 0
    schema = json.loads(result.stdout)
    assert "/v1/reports" in schema["paths"]
    assert "StageEvent" in schema["components"]["schemas"]
    calls = []
    monkeypatch.setenv("CANDOR_DATA_DIR", str(tmp_path))
    monkeypatch.setattr("candor_api.cli.uvicorn.run", lambda *args, **kwargs: calls.append(kwargs))
    result = runner.invoke(app, ["serve", "--port", "8001"])
    assert result.exit_code == 0
    assert calls[0]["port"] == 8001
    assert calls[0]["access_log"] is False


def test_request_validation_does_not_echo_worker_payload(harness: Harness) -> None:
    job_id = harness.enqueue()
    response = harness.client.post(
        f"/internal/jobs/{job_id}/complete",
        headers=harness.worker(),
        json={
            "findings": {"plaintext": "private worker result"},
            "summary": {"body": "private worker result"},
        },
    )
    assert response.status_code == 422
    assert "private worker result" not in response.text


def test_inbox_challenge_replay_and_bad_signature(harness: Harness) -> None:
    public_key = b64u(bytes(harness.inbox_sig.verify_key))
    challenge = harness.client.post("/v1/inbox/challenge", json={"sig_pk": public_key}).json()[
        "challenge"
    ]
    body = {
        "sig_pk": public_key,
        "challenge": challenge,
        "signature": b64u(secrets.token_bytes(64)),
    }
    assert harness.client.post("/v1/inbox/session", json=body).status_code == 401
    body["signature"] = b64u(
        harness.inbox_sig.sign(
            f"candor/v1/inbox-auth\n{public_key}\n{challenge}".encode()
        ).signature
    )
    assert harness.client.post("/v1/inbox/session", json=body).status_code == 200
    assert harness.client.post("/v1/inbox/session", json=body).status_code == 401


def test_app_startup_creates_three_databases(tmp_path: Path) -> None:
    settings = Settings(candor_data_dir=tmp_path)
    with TestClient(create_app(settings)) as client:
        assert client.get("/v1/health").status_code == 200
    assert all((tmp_path / f"{name}.db").exists() for name in ("reports", "audit", "payments"))
