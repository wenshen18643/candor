import secrets
from datetime import timedelta
from typing import Any

import jwt
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey
from sqlalchemy import select

from candor_api import tables as t
from candor_api.common import ApiError, b64u, now, require, stamp, unb64
from candor_api.runtime import Runtime, get_one


def verify_signature(public_key: str, signature: str, message: bytes) -> None:
    try:
        VerifyKey(unb64(public_key)).verify(message, unb64(signature))
    except (BadSignatureError, ValueError) as error:
        raise ApiError(401, "invalid_signature", "Signature verification failed") from error


def challenge(runtime: Runtime, subject: str, purpose: str) -> dict[str, str]:
    value = b64u(secrets.token_bytes(32))
    expires = stamp(now() + timedelta(seconds=120))
    with runtime.write() as connection:
        if purpose == "reviewer":
            get_one(connection, t.reviewers, t.reviewers.c.id == subject)
        connection.execute(t.challenges.delete().where(t.challenges.c.expires_at < stamp()))
        connection.execute(
            t.challenges.insert().values(
                challenge=value, subject=subject, purpose=purpose, expires_at=expires, used=False
            )
        )
    return {"challenge": value, "expires_at": expires}


def login(
    runtime: Runtime, subject: str, value: str, signature: str, purpose: str
) -> dict[str, Any]:
    with runtime.write() as connection:
        row = get_one(
            connection,
            t.challenges,
            t.challenges.c.challenge == value,
            t.challenges.c.subject == subject,
            t.challenges.c.purpose == purpose,
        )
        require(
            not row["used"] and row["expires_at"] > stamp(),
            401,
            "challenge_expired",
            "Challenge is expired or already used",
        )
        claims: dict[str, Any] = {
            "sub": subject,
            "purpose": purpose,
            "iss": "candor-api",
            "aud": "candor",
            "iat": now(),
        }
        reports: list[str] = []
        if purpose == "reviewer":
            reviewer = get_one(connection, t.reviewers, t.reviewers.c.id == subject)
            public_key = reviewer["sig_pk"]
            prefix = "auth"
            claims.update(org=reviewer["org_id"], role=reviewer["role"])
            expiry = now() + timedelta(hours=8)
        else:
            public_key, prefix = subject, "inbox-auth"
            expiry = now() + timedelta(minutes=30)
            reports = list(
                connection.execute(
                    select(t.reports.c.id).where(t.reports.c.inbox_sig_pk == subject)
                ).scalars()
            )
            claims["reports"] = reports
        verify_signature(public_key, signature, f"candor/v1/{prefix}\n{subject}\n{value}".encode())
        connection.execute(
            t.challenges.update().where(t.challenges.c.challenge == value).values(used=True)
        )
        claims["exp"] = expiry
        token = jwt.encode(claims, runtime.jwt_key, algorithm="HS256")
    result = {"token": token, "expires_at": stamp(expiry)}
    if purpose == "inbox":
        result["report_ids"] = reports
    return result


def decode(runtime: Runtime, token: str, purpose: str) -> dict[str, Any]:
    try:
        claims = jwt.decode(
            token,
            runtime.jwt_key,
            algorithms=["HS256"],
            audience="candor",
            issuer="candor-api",
            options={"require": ["sub", "exp", "iat", "purpose"]},
        )
    except jwt.PyJWTError as error:
        raise ApiError(401, "invalid_token", "Invalid or expired authentication token") from error
    require(
        claims["purpose"] == purpose, 403, "wrong_scope", "Authentication scope is not permitted"
    )
    return claims


def reviewer_for(runtime: Runtime, token: str) -> dict[str, Any]:
    claims = decode(runtime, token, "reviewer")
    with runtime.engine.connect() as connection:
        reviewer = get_one(connection, t.reviewers, t.reviewers.c.id == claims["sub"])
    require(
        reviewer["org_id"] == claims.get("org") and reviewer["role"] == claims.get("role"),
        401,
        "invalid_token",
        "Reviewer authorization changed",
    )
    return reviewer
