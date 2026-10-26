import json
import logging
import os
import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx
from nacl.signing import SigningKey
from sqlalchemy import Connection, Table, select

from candor_api import tables as t
from candor_api.audit import AuditLog, validate_entry
from candor_api.blobs import BlobStore, LocalBlobStore
from candor_api.common import ApiError, key_id, require, uid, unb64
from candor_api.database import make_engine, transaction
from candor_api.integrations import (
    EvmAnchor,
    IdentityClient,
    Issuer,
    IssuerProvider,
    LocalLauncher,
    MockAnchor,
    ModalLauncher,
)
from candor_api.payments import FacilitatorPayments, MockPayments, PaymentLedger
from candor_api.settings import Settings

logger = logging.getLogger("candor.api")


def get_one(connection: Connection, table: Table, *conditions: Any) -> dict[str, Any]:
    row = connection.execute(select(table).where(*conditions)).mappings().first()
    require(row is not None, 404, "not_found", "Resource not found")
    return dict(row)


def get_many(connection: Connection, table: Table, *conditions: Any) -> list[dict[str, Any]]:
    return [dict(row) for row in connection.execute(select(table).where(*conditions)).mappings()]


def persistent_secret(path: Path) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        return path.read_bytes()
    secret = secrets.token_bytes(32)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(secret)
        stream.flush()
        os.fsync(stream.fileno())
    return secret


class Runtime:
    def __init__(
        self,
        settings: Settings,
        issuer_provider: IssuerProvider | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self.settings = settings
        settings.candor_data_dir.mkdir(parents=True, exist_ok=True)
        self.engine = make_engine(settings.candor_reports_db_url)
        t.metadata.create_all(self.engine)
        self.initialize_message_order()
        self.client = client or httpx.Client(timeout=15, follow_redirects=False)
        self.issuers = issuer_provider or IdentityClient(settings, self.client)
        self.blobs: BlobStore = LocalBlobStore(settings.candor_data_dir / "blobs")
        secrets_dir = settings.candor_data_dir / "api-secrets"
        self.jwt_key = (
            settings.candor_jwt_secret.get_secret_value().encode()
            or persistent_secret(secrets_dir / "jwt.key").hex().encode()
        )
        link_key = (
            settings.candor_payments_link_key.get_secret_value().encode()
            or persistent_secret(secrets_dir / "payments.key").hex().encode()
        )
        signing_key = SigningKey(persistent_secret(secrets_dir / "log.key"))
        anchor = (
            MockAnchor() if settings.anchor_mode == "mock" else EvmAnchor(settings, self.client)
        )
        self.audit = AuditLog(
            settings.candor_audit_db_url, signing_key, anchor, settings.candor_anchor_every
        )
        adapter = (
            MockPayments()
            if settings.x402_mode == "mock"
            else FacilitatorPayments(settings, self.client)
        )
        self.payments = PaymentLedger(settings, link_key, adapter)
        self.launcher = ModalLauncher() if settings.modal_enabled else LocalLauncher()
        self.flush_audit()

    def initialize_message_order(self) -> None:
        with transaction(self.engine) as connection:
            rows = (
                connection.execute(
                    select(t.messages.c.id)
                    .where(~t.messages.c.id.in_(select(t.message_order.c.message_id)))
                    .order_by(t.messages.c.created_at, t.messages.c.id)
                )
                .scalars()
                .all()
            )
            for message_id in rows:
                connection.execute(t.message_order.insert().values(message_id=message_id))

    def store_message(self, connection: Connection, **fields: Any) -> None:
        connection.execute(t.messages.insert().values(**fields))
        connection.execute(t.message_order.insert().values(message_id=fields["id"]))

    def close(self) -> None:
        self.client.close()
        for engine in (self.engine, self.audit.engine, self.payments.engine):
            engine.dispose()

    @contextmanager
    def write(self) -> Iterator[Connection]:
        with transaction(self.engine) as connection:
            yield connection
        self.flush_audit()

    def emit(self, connection: Connection, entry_type: str, **fields: Any) -> str:
        entry = {"type": entry_type, **fields}
        validate_entry(entry)
        event_id = uid()
        connection.execute(t.outbox.insert().values(id=event_id, entry=entry, delivered=False))
        return event_id

    def flush_audit(self) -> None:
        with transaction(self.engine) as connection:
            pending = connection.execute(
                select(t.outbox)
                .where(t.outbox.c.delivered.is_(False))
                .order_by(t.outbox.c.sequence)
            ).mappings()
            for row in pending:
                self.audit.append(row["id"], row["entry"])
                connection.execute(
                    t.outbox.update().where(t.outbox.c.id == row["id"]).values(delivered=True)
                )
        try:
            self.audit.anchor(automatic=True)
        except Exception:
            logger.warning('{"event":"anchor_deferred"}')

    def enclave(self) -> dict[str, str]:
        path = self.settings.candor_data_dir / "demo" / "enclave.json"
        require(
            path.exists(),
            503,
            "enclave_unconfigured",
            "Provision the enclave public descriptor first",
        )
        value = json.loads(path.read_text())
        public_key = unb64(value["enc_pk"])
        require(
            len(public_key) == 32 and key_id(public_key) == value["key_id"],
            503,
            "enclave_unconfigured",
            "Invalid enclave public descriptor",
        )
        return {"key_id": value["key_id"], "enc_pk": value["enc_pk"]}

    def campaign_issuer(self, campaign_id: str) -> Issuer:
        with self.engine.connect() as connection:
            campaign = get_one(connection, t.campaigns, t.campaigns.c.id == campaign_id)
        if campaign["issuer_spki"]:
            return Issuer(key_id=campaign["issuer_key_id"], spki=campaign["issuer_spki"])
        try:
            issuer = self.issuers.fetch(campaign_id)
        except (httpx.HTTPError, ValueError, KeyError) as error:
            raise ApiError(
                503, "issuer_unavailable", "Campaign issuer is temporarily unavailable; retry later"
            ) from error
        with transaction(self.engine) as connection:
            connection.execute(
                t.campaigns.update()
                .where(t.campaigns.c.id == campaign_id)
                .values(issuer_key_id=issuer.key_id, issuer_spki=issuer.spki)
            )
        return issuer

    def report_for(
        self, connection: Connection, report_id: str, reviewer: dict[str, Any]
    ) -> dict[str, Any]:
        return get_one(
            connection,
            t.reports,
            t.reports.c.id == report_id,
            t.reports.c.org_id == reviewer["org_id"],
        )

    def recipients(self, connection: Connection, org_id: str) -> list[dict[str, Any]]:
        return get_many(connection, t.reviewers, t.reviewers.c.org_id == org_id)

    def validate_recipients(
        self, connection: Connection, org_id: str, recipient_ids: list[str]
    ) -> None:
        expected = {row["id"] for row in self.recipients(connection, org_id)}
        require(
            len(recipient_ids) == len(expected) and set(recipient_ids) == expected,
            422,
            "invalid_recipients",
            "Recipients must cover every campaign reviewer exactly once",
        )
