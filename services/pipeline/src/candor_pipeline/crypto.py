import base64
import hashlib
import json
import re
from typing import Any, Literal

from nacl.bindings import (
    crypto_aead_xchacha20poly1305_ietf_decrypt,
    crypto_aead_xchacha20poly1305_ietf_encrypt,
)
from nacl.public import PrivateKey, PublicKey, SealedBox
from nacl.utils import random
from pydantic import Field

from candor_pipeline.contracts import AnalysisPayload, AnalysisResult, Strict


class CandorBox(Strict):
    v: Literal[1] = 1
    alg: Literal["xc20p-padme"] = "xc20p-padme"
    n: str
    c: str


class AnalysisEnvelope(Strict):
    enclave_key_id: str
    sealed_key: str = Field(repr=False)
    box: CandorBox


class ReviewerKey(Strict):
    reviewer_id: str
    enc_pk: str


class SealedKey(Strict):
    reviewer_id: str
    sealed_key: str


class FindingsEnvelope(Strict):
    box: CandorBox
    sealed_keys: list[SealedKey]
    findings_sha256: str


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def unb64u(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]*", value):
        raise ValueError("invalid_base64url")
    decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    if b64u(decoded) != value:
        raise ValueError("noncanonical_base64url")
    return decoded


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def key_id(public_key: bytes) -> str:
    if len(public_key) != 32:
        raise ValueError("invalid_public_key")
    return hashlib.blake2b(public_key, digest_size=16).hexdigest()


def padded_length(length: int) -> int:
    if length < 4:
        raise ValueError("invalid_frame_length")
    exponent = length.bit_length() - 1
    significant = exponent.bit_length()
    block = 1 << max(0, exponent - significant)
    return ((length + block - 1) // block) * block


def padme(plaintext: bytes) -> bytes:
    frame = len(plaintext).to_bytes(4, "big") + plaintext
    return frame + bytes(padded_length(len(frame)) - len(frame))


def unpadme(frame: bytes) -> bytes:
    if len(frame) < 4:
        raise ValueError("invalid_frame")
    length = int.from_bytes(frame[:4], "big")
    if (
        length > len(frame) - 4
        or padded_length(length + 4) != len(frame)
        or any(frame[length + 4 :])
    ):
        raise ValueError("invalid_padding")
    return frame[4 : length + 4]


def context(purpose: str, report_id: str) -> bytes:
    return f"candor/v1/{purpose}/{report_id}".encode()


def encrypt_box(plaintext: bytes, key: bytes, aad: bytes, nonce: bytes | None = None) -> CandorBox:
    nonce = random(24) if nonce is None else nonce
    ciphertext = crypto_aead_xchacha20poly1305_ietf_encrypt(padme(plaintext), aad, nonce, key)
    return CandorBox(n=b64u(nonce), c=b64u(ciphertext))


def decrypt_box(box: CandorBox, key: bytes, aad: bytes) -> bytes:
    return unpadme(
        crypto_aead_xchacha20poly1305_ietf_decrypt(unb64u(box.c), aad, unb64u(box.n), key)
    )


def unseal_analysis(
    envelope: AnalysisEnvelope, private_key: bytes, report_id: str
) -> AnalysisPayload:
    secret = PrivateKey(private_key)
    if key_id(bytes(secret.public_key)) != envelope.enclave_key_id:
        raise ValueError("enclave_key_mismatch")
    key = SealedBox(secret).decrypt(unb64u(envelope.sealed_key))
    payload = AnalysisPayload.model_validate_json(
        decrypt_box(envelope.box, key, context("analysis", report_id))
    )
    if payload.report_id != report_id:
        raise ValueError("report_id_mismatch")
    return payload


def seal_findings(result: AnalysisResult, reviewers: list[ReviewerKey]) -> FindingsEnvelope:
    if not reviewers or len({item.reviewer_id for item in reviewers}) != len(reviewers):
        raise ValueError("invalid_reviewers")
    plaintext = canonical_json(result.model_dump(mode="json"))
    key = random(32)
    return FindingsEnvelope(
        box=encrypt_box(plaintext, key, context("findings", result.report_id)),
        sealed_keys=[
            SealedKey(
                reviewer_id=reviewer.reviewer_id,
                sealed_key=b64u(SealedBox(PublicKey(unb64u(reviewer.enc_pk))).encrypt(key)),
            )
            for reviewer in reviewers
        ],
        findings_sha256=hashlib.sha256(plaintext).hexdigest(),
    )
