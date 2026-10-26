import base64
import json
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from sqlalchemy import select

from candor_api import tables as t
from candor_api.common import b64u, now, stamp
from candor_api.database import transaction
from candor_api.payments import payments
from tests.conftest import Harness
from tests.helpers import box, mock_payment


def test_x402_quote_idempotency_and_separate_ledger(harness: Harness) -> None:
    report_id = harness.submit()
    headers = harness.login()
    path = f"/v1/reports/{report_id}/analysis"
    quote = harness.client.post(path, headers=headers)
    assert quote.status_code == 402
    assert quote.json()["accepts"][0]["maxAmountRequired"] == "500000"
    headers.update({"X-PAYMENT": mock_payment(), "Idempotency-Key": "stable-request"})
    first = harness.client.post(path, headers=headers)
    assert first.status_code == 202
    assert json.loads(base64.b64decode(first.headers["X-PAYMENT-RESPONSE"]))["success"]
    second = harness.client.post(path, headers=headers)
    assert second.json()["job_id"] == first.json()["job_id"]
    key_only = harness.client.post(
        path,
        headers={"Authorization": headers["Authorization"], "Idempotency-Key": "stable-request"},
    )
    assert key_only.status_code == 202
    assert key_only.json()["job_id"] == first.json()["job_id"]
    with harness.runtime.payments.engine.connect() as connection:
        rows = connection.execute(select(payments)).mappings().all()
        assert len(rows) == 1
        assert rows[0]["job_link"] == harness.runtime.payments.digest(first.json()["job_id"])
        assert report_id not in json.dumps(dict(rows[0]))
        assert first.json()["job_id"] not in json.dumps(dict(rows[0]))
    with harness.runtime.engine.connect() as connection:
        row = dict(connection.execute(select(t.jobs)).mappings().one())
        assert rows[0]["payer"] not in json.dumps(row)
        assert rows[0]["id"] not in json.dumps(row)
        assert rows[0]["tx_ref"] not in json.dumps(row)
    another = harness.submit()
    assert (
        harness.client.post(f"/v1/reports/{another}/analysis", headers=headers).status_code == 409
    )
    headers["Idempotency-Key"] = "different-key"
    assert harness.client.post(path, headers=headers).status_code == 409
    summaries = harness.client.get("/v1/admin/payments", headers=harness.login()).json()
    assert set(summaries[0]) == {"amount_atomic", "status"}


def test_nonce_idempotency_and_invalid_payment(harness: Harness) -> None:
    report_id = harness.submit()
    headers = {**harness.login(), "X-PAYMENT": mock_payment()}
    path = f"/v1/reports/{report_id}/analysis"
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(lambda _: harness.client.post(path, headers=headers), range(2))
        )
    assert all(response.status_code == 202 for response in responses)
    assert responses[0].json()["job_id"] == responses[1].json()["job_id"]
    headers["X-PAYMENT"] = "invalid!"
    assert harness.client.post(path, headers=headers).status_code == 402


def test_worker_leases_retry_dead_letter_and_admin(harness: Harness) -> None:
    job_id = harness.enqueue()
    assert harness.client.post("/internal/jobs/claim").status_code == 401
    assert (
        harness.client.post(
            f"/internal/jobs/{job_id}/fail",
            headers=harness.worker(),
            json={"error": "synthetic", "retryable": True},
        ).status_code
        == 409
    )
    claim = harness.client.post("/internal/jobs/claim", headers=harness.worker())
    assert claim.status_code == 200
    assert claim.json()["attempt"] == 1
    assert len(claim.json()["reviewers"]) == 3
    assert harness.client.post("/internal/jobs/claim", headers=harness.worker()).status_code == 204
    with transaction(harness.runtime.engine) as connection:
        connection.execute(
            t.jobs.update()
            .where(t.jobs.c.id == job_id)
            .values(lease_expires_at=stamp(now() - timedelta(seconds=1)), status="running")
        )
    claim = harness.client.post("/internal/jobs/claim", headers=harness.worker())
    assert claim.json()["attempt"] == 2
    failure = {"error": "sensitive worker detail must be discarded", "retryable": True}
    assert (
        harness.client.post(
            f"/internal/jobs/{job_id}/fail", headers=harness.worker(1), json=failure
        ).status_code
        == 409
    )
    assert (
        harness.client.post(
            f"/internal/jobs/{job_id}/fail", headers=harness.worker(2), json=failure
        ).status_code
        == 204
    )
    assert (
        harness.client.post("/internal/jobs/claim", headers=harness.worker()).json()["attempt"] == 3
    )
    assert (
        harness.client.post(
            f"/internal/jobs/{job_id}/fail", headers=harness.worker(3), json=failure
        ).status_code
        == 204
    )
    assert harness.client.post("/internal/jobs/claim", headers=harness.worker()).status_code == 204
    admin = harness.login()
    assert (
        harness.client.get("/v1/admin/jobs?status=dead", headers=admin).json()[0]["job_id"]
        == job_id
    )
    assert (
        harness.client.post(f"/v1/admin/jobs/{job_id}/retry", headers=harness.login(1)).status_code
        == 403
    )
    assert harness.client.post(f"/v1/admin/jobs/{job_id}/retry", headers=admin).status_code == 200
    assert (
        harness.client.post("/internal/jobs/claim", headers=harness.worker()).json()["attempt"] == 1
    )


def test_expired_final_lease_dead_letters(harness: Harness) -> None:
    job_id = harness.enqueue()
    with transaction(harness.runtime.engine) as connection:
        connection.execute(
            t.jobs.update()
            .where(t.jobs.c.id == job_id)
            .values(
                status="leased", attempts=3, lease_expires_at=stamp(now() - timedelta(seconds=1))
            )
        )
    assert harness.client.post("/internal/jobs/claim", headers=harness.worker()).status_code == 204
    response = harness.client.get(f"/v1/jobs/{job_id}", headers=harness.login())
    assert response.json()["status"] == "dead"


def test_completion_findings_and_sse_resume(harness: Harness) -> None:
    report_id = harness.submit()
    job_id = harness.enqueue(report_id)
    harness.client.post("/internal/jobs/claim", headers=harness.worker())
    event = {
        "job_id": job_id,
        "stage": "segment",
        "status": "started",
        "at": stamp(),
        "detail": "sensitive payload accidentally emitted by a worker",
        "provider": "replay",
        "model": "fixture",
    }
    assert (
        harness.client.post(
            f"/internal/jobs/{job_id}/events", headers=harness.worker(), json=event
        ).status_code
        == 204
    )
    event["status"] = "succeeded"
    assert (
        harness.client.post(
            f"/internal/jobs/{job_id}/events", headers=harness.worker(), json=event
        ).status_code
        == 204
    )
    completion = {
        "findings": {
            "box": box(),
            "findings_sha256": "cd" * 32,
            "sealed_keys": [
                {"reviewer_id": identity["id"], "sealed_key": b64u(secrets.token_bytes(80))}
                for identity in harness.identities
            ],
        },
        "summary": {
            "stages": [
                {
                    "stage": "segment",
                    "status": "succeeded",
                    "duration_ms": 1,
                    "llm_calls": 0,
                    "cost_usd": 0,
                    "provider": "replay",
                    "model": "fixture",
                }
            ],
            "metrics": {"claims_total": 2},
        },
    }
    assert (
        harness.client.post(
            f"/internal/jobs/{job_id}/complete", headers=harness.worker(), json=completion
        ).status_code
        == 204
    )
    assert (
        harness.client.post(
            f"/internal/jobs/{job_id}/complete", headers=harness.worker(), json=completion
        ).status_code
        == 204
    )
    headers = harness.login()
    result = harness.client.get(f"/v1/reports/{report_id}", headers=headers).json()
    assert (
        result["findings"]["sealed_key"] == completion["findings"]["sealed_keys"][0]["sealed_key"]
    )
    token = headers["Authorization"].split(" ", 1)[1]
    response = harness.client.get(
        f"/v1/jobs/{job_id}/events", params={"access_token": token}, headers={"Last-Event-ID": "1"}
    )
    assert response.status_code == 200
    assert "event: stage" in response.text
    assert "id: 2" in response.text
    assert "id: 1" not in response.text
    assert "event: done" in response.text
    assert event["detail"] not in response.text
    assert (
        harness.client.get(
            f"/v1/jobs/{job_id}/events", headers={**headers, "Last-Event-ID": "wrong"}
        ).status_code
        == 400
    )
    assert harness.client.get(f"/v1/jobs/{job_id}", headers=headers).json()["status"] == "succeeded"
    assert (
        harness.client.post(
            f"/internal/jobs/{job_id}/events", headers=harness.worker(), json=event
        ).status_code
        == 409
    )
