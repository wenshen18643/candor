import copy
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from nacl.signing import SigningKey
from sqlalchemy import select

from candor_api import tables as t
from candor_api.common import b64u, now, stamp, uid, unb64
from candor_api.database import transaction
from tests.conftest import Harness


def test_real_blind_submission_and_double_spend(harness: Harness) -> None:
    descriptor = harness.client.get("/v1/campaigns/northwind-ethics")
    assert descriptor.status_code == 200
    assert descriptor.json()["threshold"] == 2
    submission = harness.submission()
    response = harness.client.post("/v1/reports", json=submission)
    assert response.status_code == 201
    assert response.json()["receipt"]["log_index"] == 0
    submission["report_id"] = uid()
    response = harness.client.post("/v1/reports", json=submission)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "token_spent"
    with harness.runtime.engine.connect() as connection:
        assert len(connection.execute(select(t.spent_tokens)).all()) == 1


def test_parallel_double_spend_is_atomic(harness: Harness) -> None:
    harness.runtime.campaign_issuer("northwind-ethics")
    first = harness.submission()
    second = copy.deepcopy(first)
    second["report_id"] = uid()
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(
                lambda value: harness.client.post("/v1/reports", json=value), [first, second]
            )
        )
    assert sorted(response.status_code for response in responses) == [201, 409]


def test_token_is_bound_to_campaign(harness: Harness) -> None:
    submission = harness.submission()
    submission["campaign_id"] = "northwind-safety"
    response = harness.client.post("/v1/reports", json=submission)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_token"


@pytest.mark.parametrize(
    "mutation",
    [
        "signature",
        "prepared",
        "key_id",
        "threshold",
        "missing_share",
        "duplicate_share",
        "enclave",
        "file_index",
        "nonce",
        "extra",
    ],
)
def test_submission_validation(harness: Harness, mutation: str) -> None:
    submission = harness.submission()
    if mutation == "signature":
        submission["token"]["signature"] = b64u(secrets.token_bytes(256))
    elif mutation == "prepared":
        submission["token"]["prepared"] = b64u(secrets.token_bytes(64))
    elif mutation == "key_id":
        submission["token"]["key_id"] = "00" * 8
    elif mutation == "threshold":
        submission["key_shares"]["threshold"] = 3
    elif mutation == "missing_share":
        submission["key_shares"]["shares"].pop()
    elif mutation == "duplicate_share":
        submission["key_shares"]["shares"][1] = submission["key_shares"]["shares"][0]
    elif mutation == "enclave":
        submission["analysis"]["enclave_key_id"] = "00" * 16
    elif mutation == "file_index":
        submission["files"][0]["index"] = 1
    elif mutation == "nonce":
        submission["manifest"]["n"] += "="
    else:
        submission["plaintext"] = "must never be accepted"
    response = harness.client.post("/v1/reports", json=submission)
    assert response.status_code in {401, 422}
    with harness.runtime.engine.connect() as connection:
        assert connection.execute(select(t.spent_tokens)).first() is None


def test_reviewer_auth_expiry_replay_and_bad_signature(harness: Harness) -> None:
    identity = harness.identities[0]
    challenge = harness.client.post(
        "/v1/auth/challenge", json={"reviewer_id": identity["id"]}
    ).json()["challenge"]
    body = {
        "reviewer_id": identity["id"],
        "challenge": challenge,
        "signature": b64u(secrets.token_bytes(64)),
    }
    assert harness.client.post("/v1/auth/token", json=body).status_code == 401
    signature = (
        SigningKey(unb64(identity["sig_sk"])[:32])
        .sign(f"candor/v1/auth\n{identity['id']}\n{challenge}".encode())
        .signature
    )
    body["signature"] = b64u(signature)
    assert harness.client.post("/v1/auth/token", json=body).status_code == 200
    assert harness.client.post("/v1/auth/token", json=body).status_code == 401
    with transaction(harness.runtime.engine) as connection:
        connection.execute(
            t.challenges.update().values(used=False, expires_at=stamp(now() - timedelta(seconds=1)))
        )
    assert harness.client.post("/v1/auth/token", json=body).status_code == 401
    assert harness.client.get("/v1/me", headers=harness.login()).status_code == 200
    assert harness.client.get("/v1/reports").status_code == 401
    assert harness.client.get("/v1/reports", headers=harness.inbox_login()).status_code == 403


def test_report_detail_status_files_and_org_isolation(harness: Harness) -> None:
    report_id = harness.submit()
    headers = harness.login()
    response = harness.client.get("/v1/reports", headers=headers)
    assert response.json()[0]["file_count"] == 1
    response = harness.client.get(f"/v1/reports/{report_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["my_sealed_share"]
    assert (
        harness.client.get(f"/v1/reports/{report_id}/files/0", headers=headers).status_code == 200
    )
    assert (
        harness.client.patch(
            f"/v1/reports/{report_id}", headers=headers, json={"status": "triage"}
        ).status_code
        == 200
    )
    assert (
        harness.client.get("/v1/reports?status=triage", headers=headers).json()[0]["status"]
        == "triage"
    )
    with transaction(harness.runtime.engine) as connection:
        other_org = uid()
        connection.execute(t.orgs.insert().values(id=other_org, slug="other", name="Other"))
        connection.execute(
            t.reviewers.update()
            .where(t.reviewers.c.id == harness.identities[2]["id"])
            .values(org_id=other_org)
        )
    outsider = harness.login(2)
    assert harness.client.get(f"/v1/reports/{report_id}", headers=outsider).status_code == 404
    assert harness.client.get("/v1/reports", headers=outsider).json() == []


def test_cors_rate_limits_and_body_limits(harness: Harness) -> None:
    response = harness.client.options(
        "/v1/reports",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-PAYMENT",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert (
        harness.client.post(
            "/v1/reports", headers={"Content-Length": str(40 * 1024 * 1024 + 1)}, content=b"{}"
        ).status_code
        == 413
    )
    assert harness.client.post("/v1/chaff", content=b"chaff").status_code == 204
    harness.client.app.state.buckets.capacity = 0
    assert harness.client.get("/v1/health").status_code == 429
