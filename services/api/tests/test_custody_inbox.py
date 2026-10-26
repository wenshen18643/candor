import secrets
from datetime import timedelta

from nacl.signing import SigningKey

from candor_api import tables as t
from candor_api.common import b64u, now, stamp, uid, unb64
from candor_api.database import transaction
from tests.conftest import Harness
from tests.helpers import seal


def test_signed_quorum_and_requester_only_shares(harness: Harness) -> None:
    report_id = harness.submit()
    requester = harness.login()
    approver = harness.login(1)
    response = harness.client.post(
        f"/v1/reports/{report_id}/access-requests",
        headers=requester,
        json={"reason": "Review originals"},
    )
    assert response.status_code == 201
    request_id = response.json()["id"]
    body = {
        "resealed_share": b64u(secrets.token_bytes(81)),
        "signature": b64u(secrets.token_bytes(64)),
    }
    path = f"/v1/access-requests/{request_id}/approve"
    assert harness.client.post(path, headers=requester, json=body).status_code == 403
    assert harness.client.post(path, headers=approver, json=body).status_code == 401
    signature = (
        SigningKey(unb64(harness.identities[1]["sig_sk"])[:32])
        .sign(
            f"candor/v1/approve\n{request_id}\n{report_id}\n{harness.identities[0]['id']}".encode()
        )
        .signature
    )
    body["signature"] = b64u(signature)
    pending = harness.client.get(f"/v1/access-requests/{request_id}", headers=requester).json()
    assert pending["resealed_shares"] == []
    response = harness.client.post(path, headers=approver, json=body)
    assert response.status_code == 200
    assert response.json()["status"] == "granted"
    assert harness.client.post(path, headers=approver, json=body).status_code == 409
    assert (
        harness.client.get(f"/v1/access-requests/{request_id}", headers=approver).status_code == 404
    )
    granted = harness.client.get(f"/v1/access-requests/{request_id}", headers=requester).json()
    assert granted["resealed_shares"][0]["resealed_share"] == body["resealed_share"]
    listed = harness.client.get("/v1/access-requests?status=granted", headers=approver).json()
    assert "resealed_share" not in listed[0]["approvals"][0]
    assert listed[0]["requester_enc_pk"] == harness.identities[0]["enc_pk"]


def test_access_expiration(harness: Harness) -> None:
    report_id = harness.submit()
    headers = harness.login()
    request_id = harness.client.post(
        f"/v1/reports/{report_id}/access-requests", headers=headers, json={"reason": "Review"}
    ).json()["id"]
    with transaction(harness.runtime.engine) as connection:
        connection.execute(
            t.access_requests.update().values(expires_at=stamp(now() - timedelta(seconds=1)))
        )
    assert (
        harness.client.get(f"/v1/access-requests/{request_id}", headers=headers).json()["status"]
        == "expired"
    )


def test_inbox_encrypted_messages_and_scope(harness: Harness) -> None:
    report_id = harness.submit()
    inbox = harness.inbox_login()
    reviewer = harness.login()
    question = seal()
    response = harness.client.post(
        f"/v1/reports/{report_id}/messages",
        headers=reviewer,
        json={"box": question, "question_ids": ["Q1"]},
    )
    assert response.status_code == 201
    messages = harness.client.get("/v1/inbox/messages", headers=inbox).json()["reports"][0][
        "messages"
    ]
    assert messages[0]["box"] == question
    boxes = [{"reviewer_id": identity["id"], "box": seal()} for identity in harness.identities]
    body = {"report_id": report_id, "boxes": boxes, "answers_count": 1}
    assert harness.client.post("/v1/inbox/messages", headers=inbox, json=body).status_code == 201
    messages = harness.client.get("/v1/inbox/messages", headers=inbox).json()["reports"][0][
        "messages"
    ]
    assert all("box" not in item for item in messages[-1]["boxes"])
    detail = harness.client.get(f"/v1/reports/{report_id}", headers=reviewer).json()
    assert len(detail["messages"][-1]["boxes"]) == 1
    assert detail["messages"][-1]["boxes"][0]["reviewer_id"] == harness.identities[0]["id"]
    body["report_id"] = uid()
    assert harness.client.post("/v1/inbox/messages", headers=inbox, json=body).status_code == 403
    assert harness.client.get("/v1/inbox/messages", headers=reviewer).status_code == 403
