import json
import threading
from typing import Any

from nacl.signing import SigningKey
from sqlalchemy import Column, Integer, LargeBinary, MetaData, String, Table, select

from candor_api.common import ApiError, b64u, canonical, key_id, require, stamp, unb64
from candor_api.database import make_engine, transaction
from candor_api.integrations import AnchorAdapter
from candor_api.merkle import MerkleTree, sth_message

metadata = MetaData()
entries = Table(
    "log_entries",
    metadata,
    Column("index", Integer, primary_key=True),
    Column("event_id", String, unique=True, nullable=False),
    Column("leaf_bytes", LargeBinary, nullable=False),
    Column("entry_type", String, nullable=False),
    Column("created_at", String, nullable=False),
)
heads = Table(
    "tree_heads",
    metadata,
    Column("tree_size", Integer, primary_key=True),
    Column("root_hash", String, nullable=False),
    Column("timestamp", String, nullable=False),
    Column("signature", String, nullable=False),
)
anchors = Table(
    "anchors",
    metadata,
    Column("tree_size", Integer, primary_key=True),
    Column("root_hash", String, nullable=False),
    Column("chain", String, nullable=False),
    Column("tx_ref", String, nullable=False),
    Column("created_at", String, nullable=False),
)
FIELDS = {
    "report.submitted": {"report_id", "campaign_id", "evidence_root", "bucket"},
    "report.status_changed": {"report_id", "status", "actor"},
    "analysis.requested": {"report_id", "job_id", "payment_ref"},
    "analysis.completed": {"report_id", "job_id", "findings_sha256"},
    "findings.opened": {"report_id", "reviewer_id"},
    "access.requested": {"request_id", "report_id", "requester_id"},
    "access.approved": {"request_id", "approver_id"},
    "access.granted": {"request_id"},
    "evidence.fetched": {"report_id", "reviewer_id", "file_index"},
    "message.sent": {"report_id", "direction"},
    "anchor.published": {"tree_size", "root_hash", "chain", "tx_ref"},
}


def validate_entry(entry: dict[str, Any]) -> None:
    if entry.get("type") not in FIELDS or set(entry) != FIELDS[entry["type"]] | {"type"}:
        raise ValueError("Invalid audit fields")


class AuditLog:
    def __init__(
        self, url: str, signing_key: SigningKey, adapter: AnchorAdapter, every: int
    ) -> None:
        self.engine = make_engine(url)
        metadata.create_all(self.engine)
        self.signing_key = signing_key
        self.key_id = key_id(bytes(signing_key.verify_key))
        self.adapter = adapter
        self.every = every
        self.lock = threading.RLock()
        self.tree = MerkleTree([])
        with transaction(self.engine) as connection:
            self.refresh(connection)
            latest = (
                connection.execute(select(heads).order_by(heads.c.tree_size.desc()).limit(1))
                .mappings()
                .first()
            )
            if latest is None:
                connection.execute(heads.insert().values(**self.signed_head()))
            else:
                self.signing_key.verify_key.verify(
                    sth_message(latest["tree_size"], latest["root_hash"], latest["timestamp"]),
                    unb64(latest["signature"]),
                )
                require(
                    latest["tree_size"] == len(self.tree.leaves)
                    and latest["root_hash"] == self.tree.root().hex(),
                    503,
                    "audit_corrupt",
                    "Audit tree integrity check failed",
                )
        for anchor in self.list_anchors():
            self.record_anchor(anchor)

    def refresh(self, connection: Any) -> None:
        rows = connection.execute(
            select(entries.c.leaf_bytes)
            .where(entries.c.index >= len(self.tree.leaves))
            .order_by(entries.c.index)
        ).scalars()
        for leaf in rows:
            self.tree.append(leaf)

    def signed_head(self) -> dict[str, Any]:
        size, root, timestamp = len(self.tree.leaves), self.tree.root().hex(), stamp()
        signature = self.signing_key.sign(sth_message(size, root, timestamp)).signature
        return {
            "tree_size": size,
            "root_hash": root,
            "timestamp": timestamp,
            "signature": b64u(signature),
        }

    def append(self, event_id: str, entry: dict[str, Any]) -> int:
        validate_entry(entry)
        with self.lock, transaction(self.engine) as connection:
            existing = connection.execute(
                select(entries.c.index).where(entries.c.event_id == event_id)
            ).scalar_one_or_none()
            if existing is not None:
                return existing
            self.refresh(connection)
            index = len(self.tree.leaves)
            leaf = canonical(entry)
            connection.execute(
                entries.insert().values(
                    index=index,
                    event_id=event_id,
                    leaf_bytes=leaf,
                    entry_type=entry["type"],
                    created_at=entry.get("bucket", stamp()),
                )
            )
            self.tree.append(leaf)
            try:
                connection.execute(heads.insert().values(**self.signed_head()))
                connection.commit()
            except BaseException:
                self.tree = MerkleTree(self.tree.leaves[:-1])
                raise
            return index

    def latest(self) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = (
                connection.execute(select(heads).order_by(heads.c.tree_size.desc()).limit(1))
                .mappings()
                .one()
            )
            return {**row, "key_id": self.key_id}

    def proof(self, kind: str, first: int, second: int) -> list[str]:
        with self.lock, self.engine.connect() as connection:
            self.refresh(connection)
            try:
                path = (
                    self.tree.inclusion(first, second)
                    if kind == "inclusion"
                    else self.tree.consistency(first, second)
                )
            except ValueError as error:
                raise ApiError(400, "invalid_range", "Invalid proof range") from error
            return [value.hex() for value in path]

    def read_entries(self, start: int, end: int) -> list[dict[str, Any]]:
        require(
            0 <= start <= end and end - start <= 1000, 400, "invalid_range", "Invalid log range"
        )
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(entries)
                .where(entries.c.index >= start, entries.c.index < end)
                .order_by(entries.c.index)
            ).mappings()
            return [
                {
                    "index": row["index"],
                    "entry_type": row["entry_type"],
                    "entry": json.loads(row["leaf_bytes"]),
                    "leaf_b64u": b64u(row["leaf_bytes"]),
                    "created_at": row["created_at"],
                }
                for row in rows
            ]

    def anchor(self, automatic: bool = False) -> dict[str, Any] | None:
        with self.lock, transaction(self.engine) as connection:
            head = dict(
                connection.execute(select(heads).order_by(heads.c.tree_size.desc()).limit(1))
                .mappings()
                .one()
            )
            existing = (
                connection.execute(select(anchors).where(anchors.c.tree_size == head["tree_size"]))
                .mappings()
                .first()
            )
            if existing:
                return dict(existing)
            last = (
                connection.execute(
                    select(anchors.c.tree_size).order_by(anchors.c.tree_size.desc()).limit(1)
                ).scalar()
                or 0
            )
            if automatic and head["tree_size"] - last < self.every:
                return None
            chain, tx_ref = self.adapter.publish(head["root_hash"])
            anchor = {
                "tree_size": head["tree_size"],
                "root_hash": head["root_hash"],
                "chain": chain,
                "tx_ref": tx_ref,
                "created_at": stamp(),
            }
            connection.execute(anchors.insert().values(**anchor))
        self.record_anchor(anchor)
        return anchor

    def record_anchor(self, anchor: dict[str, Any]) -> None:
        self.append(
            f"anchor/{anchor['tree_size']}",
            {
                "type": "anchor.published",
                **{name: anchor[name] for name in FIELDS["anchor.published"]},
            },
        )

    def list_anchors(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    select(anchors).order_by(anchors.c.tree_size)
                ).mappings()
            ]
