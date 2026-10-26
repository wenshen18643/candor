import hashlib
import json
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from sqlalchemy import Connection, func, select

from candor_api import tables as t
from candor_api.audit import entries
from candor_api.common import ApiError, bucket, canonical, require, stamp, unb64
from candor_api.runtime import Runtime, get_many, get_one
from candor_api.schemas import Submission


def descriptor(runtime: Runtime, campaign_id: str) -> dict[str, Any]:
    issuer = runtime.campaign_issuer(campaign_id)
    with runtime.engine.connect() as connection:
        campaign = get_one(
            connection,
            t.campaigns,
            t.campaigns.c.id == campaign_id,
            t.campaigns.c.status == "active",
        )
        org = get_one(connection, t.orgs, t.orgs.c.id == campaign["org_id"])
        reviewers = runtime.recipients(connection, org["id"])
    return {
        "campaign_id": campaign_id,
        "org": {"slug": org["slug"], "name": org["name"]},
        **{
            name: campaign[name]
            for name in ("title", "description", "threshold", "analysis_price_usd")
        },
        "identity_url": runtime.settings.candor_identity_url,
        "issuer": issuer.model_dump(),
        "enclave": runtime.enclave(),
        "reviewers": [
            {"reviewer_id": row["id"], "display_name": row["display_name"], "enc_pk": row["enc_pk"]}
            for row in reviewers
        ],
    }


def verify_token(runtime: Runtime, submission: Submission) -> str:
    issuer = runtime.campaign_issuer(submission.campaign_id)
    require(
        submission.token.key_id == issuer.key_id,
        401,
        "invalid_token",
        "Token issuer does not match campaign",
    )
    public_key = serialization.load_der_public_key(unb64(issuer.spki))
    require(isinstance(public_key, rsa.RSAPublicKey), 503, "invalid_issuer", "Invalid issuer")
    try:
        public_key.verify(
            unb64(submission.token.signature),
            unb64(submission.token.prepared),
            padding.PSS(mgf=padding.MGF1(hashes.SHA384()), salt_length=48),
            hashes.SHA384(),
        )
    except InvalidSignature as error:
        raise ApiError(401, "invalid_token", "Blind token signature is invalid") from error
    return hashlib.sha256(unb64(submission.token.prepared)).hexdigest()


def submit(runtime: Runtime, submission: Submission) -> dict[str, Any]:
    token_hash = verify_token(runtime, submission)
    require(
        submission.analysis.enclave_key_id == runtime.enclave()["key_id"],
        422,
        "invalid_enclave",
        "Enclave key does not match",
    )
    with runtime.write() as connection:
        campaign = get_one(
            connection,
            t.campaigns,
            t.campaigns.c.id == submission.campaign_id,
            t.campaigns.c.status == "active",
        )
        require(
            submission.key_shares.threshold == campaign["threshold"],
            422,
            "invalid_threshold",
            "Share threshold does not match campaign",
        )
        runtime.validate_recipients(
            connection,
            campaign["org_id"],
            [share.reviewer_id for share in submission.key_shares.shares],
        )
        require(
            not connection.execute(
                select(t.spent_tokens).where(t.spent_tokens.c.token_hash == token_hash)
            ).first(),
            409,
            "token_spent",
            "Token has already been redeemed",
        )
        require(
            not connection.execute(
                select(t.reports.c.id).where(t.reports.c.id == submission.report_id)
            ).first(),
            409,
            "report_exists",
            "Report identifier already exists",
        )
        received = bucket()
        size = sum(len(unb64(file.box.c)) for file in submission.files)
        connection.execute(
            t.reports.insert().values(
                id=submission.report_id,
                campaign_id=submission.campaign_id,
                org_id=campaign["org_id"],
                status="received",
                received_bucket=received,
                evidence_root=submission.evidence_root,
                manifest_box=submission.manifest.model_dump(),
                analysis_box_ref=runtime.blobs.put(canonical(submission.analysis.box.model_dump())),
                analysis_sealed_key=submission.analysis.sealed_key,
                enclave_key_id=submission.analysis.enclave_key_id,
                inbox_sig_pk=submission.inbox.sig_pk,
                inbox_enc_pk=submission.inbox.enc_pk,
                size_bucket=1 << max(0, size - 1).bit_length(),
            )
        )
        for file in submission.files:
            connection.execute(
                t.report_files.insert().values(
                    report_id=submission.report_id,
                    index=file.index,
                    blob_ref=runtime.blobs.put(canonical(file.box.model_dump())),
                    size=len(unb64(file.box.c)),
                )
            )
        for share in submission.key_shares.shares:
            connection.execute(
                t.key_shares.insert().values(report_id=submission.report_id, **share.model_dump())
            )
        connection.execute(
            t.spent_tokens.insert().values(
                token_hash=token_hash, campaign_id=submission.campaign_id, spent_bucket=received
            )
        )
        event_id = runtime.emit(
            connection,
            "report.submitted",
            report_id=submission.report_id,
            campaign_id=submission.campaign_id,
            evidence_root=submission.evidence_root,
            bucket=received,
        )
    with runtime.audit.engine.connect() as connection:
        index = connection.execute(
            select(entries.c.index).where(entries.c.event_id == event_id)
        ).scalar_one()
    return {
        "report_id": submission.report_id,
        "receipt": {
            "evidence_root": submission.evidence_root,
            "log_index": index,
            "sth": runtime.audit.latest(),
        },
    }


def current_stage(connection: Connection, job_id: str) -> str | None:
    latest: dict[str, tuple[int, str]] = {}
    for seq, stage, status in connection.execute(
        select(t.job_events.c.seq, t.job_events.c.stage, t.job_events.c.status)
        .where(t.job_events.c.job_id == job_id)
        .order_by(t.job_events.c.seq)
    ):
        latest[stage] = (seq, status)
    running = [(seq, stage) for stage, (seq, status) in latest.items() if status == "started"]
    return max(running)[1] if running else None


def report_summary(
    connection: Connection, report: dict[str, Any], reviewer_id: str
) -> dict[str, Any]:
    job = (
        connection.execute(
            select(t.jobs)
            .where(t.jobs.c.report_id == report["id"])
            .order_by(t.jobs.c.created_at.desc())
            .limit(1)
        )
        .mappings()
        .first()
    )
    count = connection.execute(
        select(func.count())
        .select_from(t.report_files)
        .where(t.report_files.c.report_id == report["id"])
    ).scalar_one()
    replies = connection.execute(
        select(func.count())
        .select_from(t.messages)
        .where(
            t.messages.c.report_id == report["id"],
            t.messages.c.direction == "to_reviewers",
            ~select(t.message_reads.c.message_id)
            .where(
                t.message_reads.c.message_id == t.messages.c.id,
                t.message_reads.c.reviewer_id == reviewer_id,
            )
            .exists(),
        )
    ).scalar_one()
    pending = connection.execute(
        select(func.count())
        .select_from(t.access_requests)
        .where(
            t.access_requests.c.report_id == report["id"],
            t.access_requests.c.status == "pending",
            t.access_requests.c.expires_at > stamp(),
        )
    ).scalar_one()
    return {
        "report_id": report["id"],
        **{
            name: report[name]
            for name in ("campaign_id", "status", "received_bucket", "size_bucket")
        },
        "file_count": count,
        "analysis": {
            "status": job["status"],
            "job_id": job["id"],
            "updated_at": job["updated_at"],
            "stage": current_stage(connection, job["id"])
            if job["status"] in {"leased", "running"}
            else None,
        }
        if job
        else None,
        "unread_replies": replies,
        "pending_access": pending,
    }


def visible_messages(
    connection: Connection, report_id: str, reviewer_id: str | None
) -> list[dict[str, Any]]:
    result = []
    rows = connection.execute(
        select(t.messages)
        .join(t.message_order, t.message_order.c.message_id == t.messages.c.id)
        .where(t.messages.c.report_id == report_id)
        .order_by(t.message_order.c.sequence)
    ).mappings()
    for row in rows:
        item = {name: row[name] for name in ("id", "direction", "created_at")}
        if row["direction"] == "to_reporter":
            if reviewer_id is None:
                item["box"] = row["boxes_json"]
        elif reviewer_id:
            item["boxes"] = [box for box in row["boxes_json"] if box["reviewer_id"] == reviewer_id]
        else:
            item["boxes"] = [{"reviewer_id": box["reviewer_id"]} for box in row["boxes_json"]]
        result.append(item)
    return result


def detail(runtime: Runtime, report_id: str, reviewer: dict[str, Any]) -> dict[str, Any]:
    with runtime.write() as connection:
        report = runtime.report_for(connection, report_id, reviewer)
        connection.execute(
            t.report_reads.delete().where(
                t.report_reads.c.report_id == report_id,
                t.report_reads.c.reviewer_id == reviewer["id"],
            )
        )
        connection.execute(
            t.report_reads.insert().values(
                report_id=report_id, reviewer_id=reviewer["id"], last_read_at=stamp()
            )
        )
        unread = select(t.messages.c.id).where(
            t.messages.c.report_id == report_id,
            t.messages.c.direction == "to_reviewers",
            ~select(t.message_reads.c.message_id)
            .where(
                t.message_reads.c.message_id == t.messages.c.id,
                t.message_reads.c.reviewer_id == reviewer["id"],
            )
            .exists(),
        )
        for message_id in connection.execute(unread).scalars().all():
            connection.execute(
                t.message_reads.insert().values(message_id=message_id, reviewer_id=reviewer["id"])
            )
        share = get_one(
            connection,
            t.key_shares,
            t.key_shares.c.report_id == report_id,
            t.key_shares.c.reviewer_id == reviewer["id"],
        )
        found = (
            connection.execute(
                select(t.findings)
                .where(t.findings.c.report_id == report_id)
                .order_by(t.findings.c.created_at.desc())
                .limit(1)
            )
            .mappings()
            .first()
        )
        envelope = None
        if found:
            sealed_key = get_one(
                connection,
                t.findings_keys,
                t.findings_keys.c.job_id == found["job_id"],
                t.findings_keys.c.reviewer_id == reviewer["id"],
            )
            envelope = {name: found[name] for name in ("job_id", "box", "findings_sha256")}
            envelope["sealed_key"] = sealed_key["sealed_key"]
            runtime.emit(
                connection, "findings.opened", report_id=report_id, reviewer_id=reviewer["id"]
            )
        return {
            "report": {
                **report_summary(connection, report, reviewer["id"]),
                "evidence_root": report["evidence_root"],
                "inbox": {"sig_pk": report["inbox_sig_pk"], "enc_pk": report["inbox_enc_pk"]},
            },
            "manifest_box": report["manifest_box"],
            "files": [
                {"index": file["index"], "size": file["size"]}
                for file in get_many(
                    connection, t.report_files, t.report_files.c.report_id == report_id
                )
            ],
            "my_sealed_share": share["sealed_share"],
            "findings": envelope,
            "messages": visible_messages(connection, report_id, reviewer["id"]),
            "access_requests": get_many(
                connection, t.access_requests, t.access_requests.c.report_id == report_id
            ),
        }


def file_box(
    runtime: Runtime, report_id: str, index: int, reviewer: dict[str, Any]
) -> dict[str, Any]:
    with runtime.write() as connection:
        runtime.report_for(connection, report_id, reviewer)
        file = get_one(
            connection,
            t.report_files,
            t.report_files.c.report_id == report_id,
            t.report_files.c.index == index,
        )
        box = json.loads(runtime.blobs.get(file["blob_ref"]))
        runtime.emit(
            connection,
            "evidence.fetched",
            report_id=report_id,
            reviewer_id=reviewer["id"],
            file_index=index,
        )
    return {"index": index, "box": box}
