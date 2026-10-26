import hashlib
import json
from pathlib import Path

import httpx
import pytest
import respx
from nacl.exceptions import CryptoError
from nacl.public import PrivateKey, SealedBox

from candor_pipeline.contracts import AnalysisResult
from candor_pipeline.crypto import (
    AnalysisEnvelope,
    CandorBox,
    ReviewerKey,
    b64u,
    canonical_json,
    context,
    decrypt_box,
    encrypt_box,
    key_id,
    padded_length,
    padme,
    seal_findings,
    unb64u,
    unpadme,
    unseal_analysis,
)
from candor_pipeline.dag import DAGRunner
from candor_pipeline.worker import Worker
from tests.helpers import FakeProvider, payload


def test_shared_protocol_vectors() -> None:
    vectors = json.loads(
        (Path(__file__).parents[3] / "docs/specs/vectors/protocol-vectors.json").read_text()
    )
    for item in vectors["padme"]:
        assert padded_length(item["length"]) == item["padded"]
    item = vectors["key_id"]
    assert key_id(unb64u(item["public_key_b64u"])) == item["key_id"]
    item = vectors["candor_box"]
    key = unb64u(item["key_b64u"])
    box = CandorBox.model_validate(item["box"])
    assert decrypt_box(box, key, item["ad"].encode()) == item["plaintext"].encode()
    assert (
        encrypt_box(
            item["plaintext"].encode(), key, item["ad"].encode(), unb64u(item["nonce_b64u"])
        )
        == box
    )


@pytest.mark.parametrize("length", [0, 1, 5, 100, 1000, 65537])
def test_padme_roundtrip(length: int) -> None:
    content = bytes(length)
    assert unpadme(padme(content)) == content


@pytest.mark.parametrize("value", [b"", b"\0\0\0\x10", b"\0\0\0\0\0", b"\0\0\0\x05abcdeX"])
def test_invalid_padding_rejected(value: bytes) -> None:
    with pytest.raises(ValueError, match=r"invalid_frame|invalid_padding"):
        unpadme(value)


@pytest.mark.parametrize("value", ["YQ==", "YQ+", "YQ/", "Y Q", "YR", "x"])
def test_base64url_rejects_noncanonical(value: str) -> None:
    with pytest.raises(ValueError, match=r"base64|Invalid base64"):
        unb64u(value)


def test_crypto_authentication_and_fresh_nonce() -> None:
    key = bytes(range(32))
    box = encrypt_box(b"synthetic", key, b"context")
    assert encrypt_box(b"synthetic", key, b"context").n != box.n
    with pytest.raises(CryptoError):
        decrypt_box(box, key, b"different-context")
    with pytest.raises(CryptoError):
        decrypt_box(box, bytes(32), b"context")


def envelope(secret: PrivateKey) -> AnalysisEnvelope:
    data = payload()
    key = bytes(range(32))
    return AnalysisEnvelope(
        enclave_key_id=key_id(bytes(secret.public_key)),
        sealed_key=b64u(SealedBox(secret.public_key).encrypt(key)),
        box=encrypt_box(data.model_dump_json().encode(), key, context("analysis", data.report_id)),
    )


def test_unseal_analysis_and_key_binding() -> None:
    secret = PrivateKey.generate()
    assert unseal_analysis(envelope(secret), bytes(secret), payload().report_id) == payload()
    with pytest.raises(ValueError, match="enclave_key_mismatch"):
        unseal_analysis(envelope(secret), bytes(PrivateKey.generate()), payload().report_id)
    with pytest.raises(CryptoError):
        unseal_analysis(envelope(secret), bytes(secret), "different-report")


async def test_findings_each_reviewer_can_decrypt() -> None:
    result = await DAGRunner(FakeProvider()).run(payload())
    secrets = [PrivateKey.generate(), PrivateKey.generate()]
    reviewers = [
        ReviewerKey(reviewer_id=str(index), enc_pk=b64u(bytes(secret.public_key)))
        for index, secret in enumerate(secrets)
    ]
    findings = seal_findings(result, reviewers)
    for wrapped, secret in zip(findings.sealed_keys, secrets, strict=True):
        key = SealedBox(secret).decrypt(unb64u(wrapped.sealed_key))
        plaintext = decrypt_box(findings.box, key, context("findings", result.report_id))
        assert hashlib.sha256(plaintext).hexdigest() == findings.findings_sha256
        assert plaintext == canonical_json(result.model_dump(mode="json"))
        assert AnalysisResult.model_validate_json(plaintext) == result


@respx.mock
async def test_worker_claim_events_encrypted_complete() -> None:
    secret, reviewer = PrivateKey.generate(), PrivateKey.generate()
    job = {
        "job_id": "synthetic-job",
        "report_id": payload().report_id,
        "attempt": 1,
        "analysis": envelope(secret).model_dump(),
        "reviewers": [{"reviewer_id": "reviewer", "enc_pk": b64u(bytes(reviewer.public_key))}],
    }
    respx.post("https://api.invalid/internal/jobs/claim").mock(
        return_value=httpx.Response(200, json=job)
    )
    events = respx.post("https://api.invalid/internal/jobs/synthetic-job/events").mock(
        return_value=httpx.Response(204)
    )
    complete = respx.post("https://api.invalid/internal/jobs/synthetic-job/complete").mock(
        return_value=httpx.Response(204)
    )
    async with httpx.AsyncClient(
        base_url="https://api.invalid", headers={"Authorization": "Bearer test"}
    ) as client:
        assert await Worker(client, bytes(secret), DAGRunner(FakeProvider())).once()
    assert events.call_count == 24
    body = json.loads(complete.calls[0].request.content)
    assert "PERSON_1" not in json.dumps(body)
    assert "statement" not in json.dumps(body["summary"])
    findings = body["findings"]
    key = SealedBox(reviewer).decrypt(unb64u(findings["sealed_keys"][0]["sealed_key"]))
    plaintext = decrypt_box(
        CandorBox.model_validate(findings["box"]), key, context("findings", payload().report_id)
    )
    assert AnalysisResult.model_validate_json(plaintext).metrics.citations_verified == 1


@respx.mock
async def test_worker_no_job() -> None:
    respx.post("https://api.invalid/internal/jobs/claim").mock(return_value=httpx.Response(204))
    async with httpx.AsyncClient(base_url="https://api.invalid") as client:
        assert not await Worker(client, bytes(PrivateKey.generate())).once()


@respx.mock
async def test_worker_failure_contains_no_evidence() -> None:
    secret = PrivateKey.generate()
    job = {
        "job_id": "synthetic-job",
        "report_id": "wrong-context",
        "attempt": 1,
        "analysis": envelope(secret).model_dump(),
        "reviewers": [],
    }
    respx.post("https://api.invalid/internal/jobs/claim").mock(
        return_value=httpx.Response(200, json=job)
    )
    failed = respx.post("https://api.invalid/internal/jobs/synthetic-job/fail").mock(
        return_value=httpx.Response(204)
    )
    async with httpx.AsyncClient(base_url="https://api.invalid") as client:
        await Worker(client, bytes(secret), DAGRunner(FakeProvider())).once()
    assert json.loads(failed.calls[0].request.content) == {
        "error": "analysis_failed",
        "retryable": False,
    }
