import asyncio
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from nacl.signing import SigningKey
from sqlalchemy import select

from candor_api import jobs
from candor_api import tables as t
from candor_api.common import ApiError, b64u, bucket, now, stamp, uid, unb64
from candor_api.database import transaction
from candor_api.payments import payments
from candor_api.reports import visible_messages
from candor_api.runtime import Runtime
from candor_api.settings import Settings
from tests.conftest import Harness
from tests.helpers import box, mock_payment, seal


def completion(harness: Harness) -> dict[str, Any]:
    return {
        "findings": {
            "box": box(),
            "findings_sha256": "cd" * 32,
            "sealed_keys": [
                {"reviewer_id": person["id"], "sealed_key": b64u(secrets.token_bytes(80))}
                for person in harness.identities
            ],
        },
        "summary": {"stages": [], "metrics": {}},
    }


def test_reporter_timestamps_are_hour_buckets(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    current = datetime(2026, 10, 26, 12, 34, 56, 123456, tzinfo=UTC)
    monkeypatch.setattr("candor_api.common.now", lambda: current)
    submission = harness.client.post("/v1/reports", json=harness.submission())
    assert submission.status_code == 201
    assert submission.json()["receipt"]["sth"]["timestamp"] == "2026-10-26T12:00:00Z"
    report_id = submission.json()["report_id"]
    monkeypatch.undo()
    inbox = harness.inbox_login()
    monkeypatch.setattr("candor_api.common.now", lambda: current)
    response = harness.client.post(
        "/v1/inbox/messages",
        headers=inbox,
        json={
            "report_id": report_id,
            "boxes": [
                {"reviewer_id": person["id"], "box": seal()} for person in harness.identities
            ],
            "answers_count": 0,
        },
    )
    assert response.status_code == 201
    with harness.runtime.engine.connect() as connection:
        assert (
            connection.execute(select(t.messages.c.created_at)).scalar_one()
            == "2026-10-26T12:00:00Z"
        )
    anchor = harness.runtime.audit.anchor()
    assert anchor is not None
    assert anchor["created_at"] == "2026-10-26T12:00:00Z"


def test_inbox_challenges_do_not_persist_report_identifiers(harness: Harness) -> None:
    harness.submit()
    public_key = b64u(bytes(harness.inbox_sig.verify_key))
    assert (
        harness.client.post("/v1/inbox/challenge", json={"sig_pk": public_key}).status_code == 200
    )
    with harness.runtime.engine.connect() as connection:
        subjects = connection.execute(select(t.challenges.c.subject)).scalars().all()
    assert all(subject != public_key for subject in subjects)


@pytest.mark.parametrize("operation", ["events", "complete", "fail"])
def test_worker_cannot_omit_attempt_fence(harness: Harness, operation: str) -> None:
    job_id = harness.enqueue()
    harness.client.post("/internal/jobs/claim", headers=harness.worker())
    bodies = {
        "events": {"job_id": job_id, "stage": "segment", "status": "started", "at": stamp()},
        "complete": completion(harness),
        "fail": {"error": "synthetic", "retryable": True},
    }
    response = harness.client.post(
        f"/internal/jobs/{job_id}/{operation}", headers=harness.worker(), json=bodies[operation]
    )
    assert response.status_code == 409


def test_admin_retry_does_not_reuse_attempt_fence(harness: Harness) -> None:
    job_id = harness.enqueue()
    first = harness.client.post("/internal/jobs/claim", headers=harness.worker()).json()["attempt"]
    failure = {"error": "synthetic", "retryable": False}
    assert (
        harness.client.post(
            f"/internal/jobs/{job_id}/fail", headers=harness.worker(first), json=failure
        ).status_code
        == 204
    )
    assert (
        harness.client.post(f"/v1/admin/jobs/{job_id}/retry", headers=harness.login()).status_code
        == 200
    )
    second = harness.client.post("/internal/jobs/claim", headers=harness.worker()).json()["attempt"]
    assert second > first
    assert (
        harness.client.post(
            f"/internal/jobs/{job_id}/fail", headers=harness.worker(first), json=failure
        ).status_code
        == 409
    )


def test_completed_job_still_requires_current_attempt(harness: Harness) -> None:
    job_id = harness.enqueue()
    harness.client.post("/internal/jobs/claim", headers=harness.worker())
    body = completion(harness)
    path = f"/internal/jobs/{job_id}/complete"
    assert harness.client.post(path, headers=harness.worker(1), json=body).status_code == 204
    assert harness.client.post(path, headers=harness.worker(2), json=body).status_code == 409


def test_settled_payment_cannot_switch_reports_after_job_rollback(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    first, second = harness.submit(), harness.submit()
    reviewer = harness.identities[0]
    payload = harness.runtime.payments.decode(mock_payment())

    def fail_emit(*args: Any, **kwargs: Any) -> str:
        raise RuntimeError("synthetic transaction failure")

    with monkeypatch.context() as patch:
        patch.setattr(harness.runtime, "emit", fail_emit)
        with pytest.raises(RuntimeError, match="synthetic transaction failure"):
            jobs.enqueue(harness.runtime, first, reviewer, payload, "rollback-key")
    with pytest.raises(ApiError, match="payment_replayed"):
        jobs.enqueue(harness.runtime, second, reviewer, payload, "rollback-key")
    recovered, _ = jobs.enqueue(harness.runtime, first, reviewer, payload, "rollback-key")
    assert recovered["status"] == "queued"


def test_deep_json_is_rejected_without_echo(harness: Harness) -> None:
    response = harness.client.post(
        "/v1/inbox/challenge",
        content='{"unknown":' + "[" * 2000 + "0" + "]" * 2000 + "}",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_payment_timestamps_cannot_join_jobs_by_precise_time(harness: Harness) -> None:
    harness.enqueue()
    with harness.runtime.payments.engine.connect() as connection:
        timestamp = connection.execute(select(payments.c.created_at)).scalar_one()
    assert timestamp == bucket()


def test_hour_bucketed_replies_keep_unread_tracking(harness: Harness) -> None:
    report_id = harness.submit()
    reviewer = harness.login()
    inbox = harness.inbox_login()
    body = {
        "report_id": report_id,
        "boxes": [{"reviewer_id": person["id"], "box": seal()} for person in harness.identities],
        "answers_count": 0,
    }
    assert harness.client.get(f"/v1/reports/{report_id}", headers=reviewer).status_code == 200
    for _ in range(2):
        assert (
            harness.client.post("/v1/inbox/messages", headers=inbox, json=body).status_code == 201
        )
        assert harness.client.get("/v1/reports", headers=reviewer).json()[0]["unread_replies"] == 1
        assert harness.client.get(f"/v1/reports/{report_id}", headers=reviewer).status_code == 200
        assert harness.client.get("/v1/reports", headers=reviewer).json()[0]["unread_replies"] == 0


async def test_sse_connections_are_bounded_per_reviewer(harness: Harness) -> None:
    job_id = harness.enqueue()
    headers = harness.login()
    transport = httpx.ASGITransport(app=harness.client.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        tasks = [
            asyncio.create_task(client.get(f"/v1/jobs/{job_id}/events", headers=headers))
            for _ in range(5)
        ]
        try:
            done, _ = await asyncio.wait(tasks, timeout=2, return_when=asyncio.FIRST_COMPLETED)
            assert len(done) == 1
            assert next(iter(done)).result().status_code == 429
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        assert not harness.client.app.state.stream_limits.active


def test_reviewer_routes_reject_foreign_organisation(harness: Harness) -> None:
    report_id = harness.submit()
    job_id = harness.enqueue(report_id)
    request_id = harness.client.post(
        f"/v1/reports/{report_id}/access-requests",
        headers=harness.login(),
        json={"reason": "Review"},
    ).json()["id"]
    with transaction(harness.runtime.engine) as connection:
        org_id = uid()
        connection.execute(t.orgs.insert().values(id=org_id, slug="other", name="Other"))
        connection.execute(
            t.reviewers.update()
            .where(t.reviewers.c.id == harness.identities[2]["id"])
            .values(org_id=org_id, role="admin")
        )
    outsider = harness.login(2)
    routes = [
        ("GET", f"/v1/reports/{report_id}", None),
        ("GET", f"/v1/reports/{report_id}/files/0", None),
        ("PATCH", f"/v1/reports/{report_id}", {"status": "closed"}),
        ("POST", f"/v1/reports/{report_id}/analysis", None),
        ("GET", f"/v1/jobs/{job_id}", None),
        ("GET", f"/v1/jobs/{job_id}/events", None),
        ("POST", f"/v1/reports/{report_id}/messages", {"box": seal()}),
        ("POST", f"/v1/reports/{report_id}/access-requests", {"reason": "Review"}),
        ("GET", f"/v1/access-requests/{request_id}", None),
        (
            "POST",
            f"/v1/access-requests/{request_id}/approve",
            {
                "signature": b64u(secrets.token_bytes(64)),
                "resealed_share": b64u(secrets.token_bytes(81)),
            },
        ),
        ("POST", f"/v1/admin/jobs/{job_id}/retry", None),
    ]
    for method, path, body in routes:
        assert harness.client.request(method, path, headers=outsider, json=body).status_code == 404
    for path in ("/v1/reports", "/v1/access-requests", "/v1/admin/jobs?status=queued"):
        assert harness.client.get(path, headers=outsider).json() == []


def test_quorum_rejects_duplicate_wrong_context_and_expired_approval(harness: Harness) -> None:
    with transaction(harness.runtime.engine) as connection:
        connection.execute(t.campaigns.update().values(threshold=3))
    submission = harness.submission()
    submission["key_shares"]["threshold"] = 3
    assert harness.client.post("/v1/reports", json=submission).status_code == 201
    report_id = submission["report_id"]
    request_id = harness.client.post(
        f"/v1/reports/{report_id}/access-requests",
        headers=harness.login(),
        json={"reason": "Review"},
    ).json()["id"]
    signer = SigningKey(unb64(harness.identities[1]["sig_sk"])[:32])
    message = (
        f"candor/v1/approve\n{request_id}\n{report_id}\n{harness.identities[0]['id']}".encode()
    )
    body = {
        "resealed_share": b64u(secrets.token_bytes(81)),
        "signature": b64u(signer.sign(message + b"\n").signature),
    }
    headers = harness.login(1)
    path = f"/v1/access-requests/{request_id}/approve"
    assert harness.client.post(path, headers=headers, json=body).status_code == 401
    body["signature"] = b64u(signer.sign(message).signature)
    assert harness.client.post(path, headers=headers, json=body).json()["status"] == "pending"
    assert harness.client.post(path, headers=headers, json=body).status_code == 409
    with transaction(harness.runtime.engine) as connection:
        connection.execute(
            t.access_requests.update().values(expires_at=stamp(now() - timedelta(seconds=1)))
        )
    headers = harness.login(2)
    signer = SigningKey(unb64(harness.identities[2]["sig_sk"])[:32])
    body["signature"] = b64u(signer.sign(message).signature)
    assert harness.client.post(path, headers=headers, json=body).status_code == 409


def test_sse_stops_after_authorization_revocation(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id = harness.enqueue()
    headers = harness.login()
    original = jobs.events_after

    def revoke(*args: Any) -> tuple[list[dict[str, Any]], str]:
        result = original(*args)
        with transaction(harness.runtime.engine) as connection:
            connection.execute(
                t.reviewers.update()
                .where(t.reviewers.c.id == harness.identities[0]["id"])
                .values(role="reviewer")
            )
        return result

    monkeypatch.setattr(jobs, "events_after", revoke)
    response = harness.client.get(f"/v1/jobs/{job_id}/events", headers=headers)
    assert response.status_code == 200
    assert "auth_expired" in response.text
    assert not harness.client.app.state.stream_limits.active


def test_production_rejects_mock_anchoring() -> None:
    with pytest.raises(ValueError, match="mock anchoring"):
        Settings(
            candor_mode="production",
            candor_worker_token=secrets.token_hex(32),
            candor_jwt_secret=secrets.token_hex(32),
            candor_payments_link_key=secrets.token_hex(32),
            x402_mode="testnet",
            anchor_mode="mock",
        )


def test_restart_backfills_legacy_message_order_once(harness: Harness) -> None:
    report_id = harness.submit()
    identifiers = [uid(), uid()]
    with transaction(harness.runtime.engine) as connection:
        for index in (1, 0):
            connection.execute(
                t.messages.insert().values(
                    id=identifiers[index],
                    report_id=report_id,
                    direction="to_reporter",
                    sender_reviewer_id=harness.identities[0]["id"],
                    boxes_json=seal(),
                    created_at=f"2026-10-26T12:0{index}:00Z",
                )
            )
    restarted = Runtime(harness.runtime.settings, harness.runtime.issuers)
    try:
        restarted.initialize_message_order()
        with restarted.engine.connect() as connection:
            messages = visible_messages(connection, report_id, None)
            assert [message["id"] for message in messages] == identifiers
            assert len(connection.execute(select(t.message_order)).all()) == 2
    finally:
        restarted.close()


def test_sse_drains_bounded_batches_before_done(harness: Harness) -> None:
    job_id = harness.enqueue()
    with transaction(harness.runtime.engine) as connection:
        connection.execute(t.jobs.update().where(t.jobs.c.id == job_id).values(status="succeeded"))
        connection.execute(
            t.job_events.insert(),
            [
                {
                    "job_id": job_id,
                    "seq": index,
                    "stage": "segment",
                    "status": "succeeded",
                    "at": stamp(),
                    "detail": "",
                    "progress": None,
                    "provider": None,
                    "model": None,
                }
                for index in range(1, 102)
            ],
        )
    response = harness.client.get(f"/v1/jobs/{job_id}/events", headers=harness.login())
    assert response.status_code == 200
    assert response.text.count("event: stage") == 101
    assert response.text.index("id: 101") < response.text.index("event: done")
