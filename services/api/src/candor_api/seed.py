import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
from nacl.public import PrivateKey
from nacl.signing import SigningKey
from sqlalchemy import select

from candor_api import tables as t
from candor_api.audit import metadata as audit_metadata
from candor_api.common import b64u, key_id, stamp, uid
from candor_api.database import make_engine, transaction
from candor_api.integrations import IdentityClient
from candor_api.payments import metadata as payments_metadata
from candor_api.runtime import Runtime, persistent_secret
from candor_api.settings import Settings


def write_private(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(value)


def reset_databases(settings: Settings) -> None:
    for metadata, url in (
        (t.metadata, settings.candor_reports_db_url),
        (audit_metadata, settings.candor_audit_db_url),
        (payments_metadata, settings.candor_payments_db_url),
    ):
        engine = make_engine(url)
        metadata.drop_all(engine)
        engine.dispose()
    for name in ("log.key", "payments.key", "jwt.key"):
        (settings.candor_data_dir / "api-secrets" / name).unlink(missing_ok=True)


def seed(
    settings: Settings,
    reset: bool = False,
    warn: Callable[[str], None] = print,
    client: httpx.Client | None = None,
) -> None:
    if settings.candor_mode != "demo":
        raise ValueError("Demo seeding is disabled in production")
    settings.candor_data_dir.mkdir(parents=True, exist_ok=True)
    if reset:
        reset_databases(settings)
    runtime = Runtime(settings, client=client)
    try:
        with transaction(runtime.engine) as connection:
            exists = connection.execute(select(t.orgs).where(t.orgs.c.slug == "northwind")).first()
            if not exists:
                identities, enclave = seed_rows(connection, settings)
                directory = settings.candor_data_dir / "demo"
                write_private(directory / "identities.json", json.dumps(identities, indent=2))
                write_private(
                    directory / "enclave.json",
                    json.dumps(
                        {
                            "key_id": key_id(bytes(enclave.public_key)),
                            "enc_pk": b64u(bytes(enclave.public_key)),
                        },
                        indent=2,
                    ),
                )
                write_environment(settings, enclave)
        identity = IdentityClient(settings, runtime.client)
        for campaign in ("northwind-ethics", "northwind-safety"):
            try:
                identity.register(campaign)
                issuer = identity.fetch(campaign)
                with transaction(runtime.engine) as connection:
                    connection.execute(
                        t.campaigns.update()
                        .where(t.campaigns.c.id == campaign)
                        .values(issuer_key_id=issuer.key_id, issuer_spki=issuer.spki)
                    )
            except (httpx.HTTPError, ValueError, KeyError):
                warn(
                    f"Warning: identity service unavailable for {campaign}; "
                    "descriptor will retry issuer registration and retrieval later."
                )
    finally:
        runtime.close()


def seed_rows(connection: Any, settings: Settings) -> tuple[list[dict[str, Any]], PrivateKey]:
    org_id = uid()
    connection.execute(t.orgs.insert().values(id=org_id, slug="northwind", name="Northwind Health"))
    identities = []
    for name, role in (
        ("Avery Chen", "admin"),
        ("Morgan Ellis", "reviewer"),
        ("Riley Park", "auditor"),
    ):
        enc, sig = PrivateKey.generate(), SigningKey.generate()
        row = {
            "id": uid(),
            "org_id": org_id,
            "display_name": name,
            "role": role,
            "enc_pk": b64u(bytes(enc.public_key)),
            "sig_pk": b64u(bytes(sig.verify_key)),
            "created_at": stamp(),
        }
        connection.execute(t.reviewers.insert().values(**row))
        identities.append(
            {
                **row,
                "reviewer_id": row["id"],
                "name": name,
                "enc_sk": b64u(bytes(enc)),
                "sig_sk": b64u(bytes(sig) + bytes(sig.verify_key)),
            }
        )
    for suffix, title in (("ethics", "Ethics and integrity"), ("safety", "Patient safety")):
        connection.execute(
            t.campaigns.insert().values(
                id="northwind-" + suffix,
                org_id=org_id,
                title=title,
                description="Confidential reporting to Northwind Health",
                threshold=2,
                issuer_key_id="",
                issuer_spki="",
                analysis_price_usd=settings.x402_price_usd,
                status="active",
            )
        )
    return identities, PrivateKey.generate()


def write_environment(settings: Settings, enclave: PrivateKey) -> None:
    root = settings.candor_data_dir
    secrets_dir = root / "api-secrets"
    values = {
        "CANDOR_DATA_DIR": root.resolve().as_posix(),
        "CANDOR_MODE": "demo",
        "CANDOR_API_URL": settings.candor_api_url,
        "CANDOR_IDENTITY_URL": settings.candor_identity_url,
        "CANDOR_ENCLAVE_SK": b64u(bytes(enclave)),
        "CANDOR_WORKER_TOKEN": settings.candor_worker_token.get_secret_value()
        or b64u(persistent_secret(secrets_dir / "worker.key")),
        "CANDOR_JWT_SECRET": settings.candor_jwt_secret.get_secret_value()
        or persistent_secret(secrets_dir / "jwt.key").hex(),
        "CANDOR_PAYMENTS_LINK_KEY": settings.candor_payments_link_key.get_secret_value()
        or persistent_secret(secrets_dir / "payments.key").hex(),
        "CANDOR_IDENTITY_ADMIN_TOKEN": settings.candor_identity_admin_token.get_secret_value(),
    }
    write_private(
        root / "demo" / ".env.local",
        "\n".join(f"{name}={json.dumps(value)}" for name, value in values.items()) + "\n",
    )
