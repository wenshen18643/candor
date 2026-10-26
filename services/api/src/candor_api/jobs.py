import json
import logging
import re
from datetime import timedelta
from typing import Any
from uuid import UUID

from candor_pipeline.contracts import StageEvent
from sqlalchemy import Connection, and_, func, or_, select

from candor_api import tables as t
from candor_api.common import now, require, stamp
from candor_api.payments import PaymentPayload
from candor_api.runtime import Runtime, get_one
from candor_api.schemas import Completion, Failure

logger = logging.getLogger("candor.api")
TERMINAL = {"succeeded", "dead", "failed"}
LEASE = timedelta(minutes=10)


def enqueue(
    runtime: Runtime,
    report_id: str,
    reviewer: dict[str, Any],
    payload: PaymentPayload,
    idempotency: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    payer, nonce = payload.identity()
    identity = idempotency or payer + "/" + nonce
    require(0 < len(identity) <= 256, 400, "invalid_idempotency", "Invalid idempotency key")
    identifier = runtime.payments.digest("idempotency/" + reviewer["org_id"] + "/" + identity)
    job_digest = runtime.payments.digest("job/" + identifier + "/" + report_id)
    job_id = str(UUID(bytes=bytes.fromhex(job_digest)[:16], version=4))
    with runtime.write() as connection:
        report = runtime.report_for(connection, report_id, reviewer)
        existing = (
            connection.execute(select(t.jobs).where(t.jobs.c.idempotency_key == identifier))
            .mappings()
            .first()
        )
        if existing:
            require(
                existing["report_id"] == report_id,
                409,
                "idempotency_conflict",
                "Idempotency key belongs to another report",
            )
            return job_response(dict(existing)), runtime.payments.get_receipt(existing["id"])
        campaign = get_one(connection, t.campaigns, t.campaigns.c.id == report["campaign_id"])
        requirements = runtime.payments.requirements(
            campaign["analysis_price_usd"],
            f"{runtime.settings.candor_api_url}/v1/reports/{report_id}/analysis",
        )
        receipt = runtime.payments.charge(job_id, payload, requirements)
        created = stamp()
        payment = {
            "scheme": "exact",
            "network": runtime.settings.x402_network,
            "amount_atomic": requirements["maxAmountRequired"],
            "status": "settled",
        }
        job = {
            "id": job_id,
            "report_id": report_id,
            "kind": "analysis",
            "status": "queued",
            "attempts": 0,
            "max_attempts": 3,
            "idempotency_key": identifier,
            "payment_ref": runtime.payments.digest("receipt/" + job_id),
            "created_at": created,
            "updated_at": created,
            "payment_response": payment,
        }
        connection.execute(t.jobs.insert().values(**job))
        runtime.emit(
            connection,
            "analysis.requested",
            report_id=report_id,
            job_id=job_id,
            payment_ref=job["payment_ref"],
        )
    try:
        runtime.launcher.spawn()
    except Exception:
        logger.warning('{"event":"worker_spawn_deferred"}')
    return job_response(job), receipt


def job_response(job: dict[str, Any]) -> dict[str, Any]:
    return {"job_id": job["id"], "status": job["status"], "payment": job["payment_response"]}


def replay(
    runtime: Runtime, report_id: str, reviewer: dict[str, Any], idempotency: str
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    require(0 < len(idempotency) <= 256, 400, "invalid_idempotency", "Invalid idempotency key")
    identifier = runtime.payments.digest("idempotency/" + reviewer["org_id"] + "/" + idempotency)
    with runtime.engine.connect() as connection:
        job = (
            connection.execute(select(t.jobs).where(t.jobs.c.idempotency_key == identifier))
            .mappings()
            .first()
        )
        if job is None:
            return None
        require(
            job["report_id"] == report_id,
            409,
            "idempotency_conflict",
            "Idempotency key belongs to another report",
        )
        return job_response(dict(job)), runtime.payments.get_receipt(job["id"])


def claim(runtime: Runtime) -> dict[str, Any] | None:
    with runtime.write() as connection:
        expired = and_(
            t.jobs.c.status.in_(["leased", "running"]), t.jobs.c.lease_expires_at <= stamp()
        )
        connection.execute(
            t.jobs.update()
            .where(expired, t.jobs.c.attempts >= t.jobs.c.max_attempts)
            .values(
                status="dead", last_error="lease_expired", lease_expires_at=None, updated_at=stamp()
            )
        )
        row = (
            connection.execute(
                select(t.jobs)
                .where(
                    or_(t.jobs.c.status == "queued", expired),
                    t.jobs.c.attempts < t.jobs.c.max_attempts,
                )
                .order_by(t.jobs.c.created_at, t.jobs.c.id)
                .limit(1)
            )
            .mappings()
            .first()
        )
        if row is None:
            return None
        job = dict(row)
        attempt = job["attempts"] + 1
        connection.execute(
            t.jobs.update()
            .where(t.jobs.c.id == job["id"])
            .values(
                status="leased",
                attempts=attempt,
                lease_expires_at=stamp(now() + LEASE),
                updated_at=stamp(),
            )
        )
        report = get_one(connection, t.reports, t.reports.c.id == job["report_id"])
        return {
            "job_id": job["id"],
            "report_id": report["id"],
            "attempt": attempt,
            "analysis": {
                "sealed_key": report["analysis_sealed_key"],
                "box": json.loads(runtime.blobs.get(report["analysis_box_ref"])),
                "enclave_key_id": report["enclave_key_id"],
            },
            "reviewers": [
                {"reviewer_id": row["id"], "enc_pk": row["enc_pk"]}
                for row in runtime.recipients(connection, report["org_id"])
            ],
        }


def check_attempt(job: dict[str, Any], attempt: int | None) -> None:
    require(
        attempt is not None and attempt == job["attempts"],
        409,
        "stale_attempt",
        "Current worker attempt is required",
    )


def active_job(connection: Connection, job_id: str, attempt: int | None) -> dict[str, Any]:
    job = get_one(connection, t.jobs, t.jobs.c.id == job_id)
    require(
        job["status"] in {"leased", "running"} and job["lease_expires_at"] > stamp(),
        409,
        "invalid_lease",
        "Job does not have an active lease",
    )
    check_attempt(job, attempt)
    return job


def event(runtime: Runtime, job_id: str, value: StageEvent, attempt: int | None) -> None:
    require(value.job_id == job_id, 422, "job_mismatch", "Event job does not match route")
    with runtime.write() as connection:
        active_job(connection, job_id, attempt)
        seq = (
            connection.execute(
                select(func.max(t.job_events.c.seq)).where(t.job_events.c.job_id == job_id)
            ).scalar()
            or 0
        ) + 1
        data = value.model_dump(mode="json")
        data["detail"] = ""
        for name in ("provider", "model"):
            text = data[name]
            if text is not None and not re.fullmatch(r"[A-Za-z0-9_.:/-]{0,100}", text):
                data[name] = None
        connection.execute(t.job_events.insert().values(**data, seq=seq))
        connection.execute(
            t.jobs.update()
            .where(t.jobs.c.id == job_id)
            .values(status="running", lease_expires_at=stamp(now() + LEASE), updated_at=stamp())
        )


def heartbeat(runtime: Runtime, job_id: str, attempt: int | None) -> None:
    with runtime.write() as connection:
        active_job(connection, job_id, attempt)
        connection.execute(
            t.jobs.update()
            .where(t.jobs.c.id == job_id)
            .values(lease_expires_at=stamp(now() + LEASE), updated_at=stamp())
        )


def complete(runtime: Runtime, job_id: str, value: Completion, attempt: int | None) -> None:
    with runtime.write() as connection:
        job = get_one(connection, t.jobs, t.jobs.c.id == job_id)
        check_attempt(job, attempt)
        if job["status"] == "succeeded":
            old = get_one(connection, t.findings, t.findings.c.job_id == job_id)
            require(
                old["findings_sha256"] == value.findings.findings_sha256
                and old["box"] == value.findings.box.model_dump(),
                409,
                "completion_conflict",
                "Job already completed with different findings",
            )
            return
        job = active_job(connection, job_id, attempt)
        report = get_one(connection, t.reports, t.reports.c.id == job["report_id"])
        runtime.validate_recipients(
            connection, report["org_id"], [key.reviewer_id for key in value.findings.sealed_keys]
        )
        connection.execute(
            t.findings.insert().values(
                report_id=report["id"],
                job_id=job_id,
                box=value.findings.box.model_dump(),
                findings_sha256=value.findings.findings_sha256,
                created_at=stamp(),
            )
        )
        for key in value.findings.sealed_keys:
            connection.execute(
                t.findings_keys.insert().values(
                    report_id=report["id"], job_id=job_id, **key.model_dump()
                )
            )
        connection.execute(
            t.jobs.update()
            .where(t.jobs.c.id == job_id)
            .values(
                status="succeeded",
                lease_expires_at=None,
                summary_json=value.summary.model_dump(mode="json"),
                updated_at=stamp(),
            )
        )
        runtime.emit(
            connection,
            "analysis.completed",
            report_id=report["id"],
            job_id=job_id,
            findings_sha256=value.findings.findings_sha256,
        )


def fail(runtime: Runtime, job_id: str, value: Failure, attempt: int | None) -> None:
    with runtime.write() as connection:
        job = active_job(connection, job_id, attempt)
        status = "queued" if value.retryable and job["attempts"] < job["max_attempts"] else "dead"
        connection.execute(
            t.jobs.update()
            .where(t.jobs.c.id == job_id)
            .values(
                status=status,
                lease_expires_at=None,
                last_error="worker_retryable" if value.retryable else "worker_failed",
                updated_at=stamp(),
            )
        )


def events_after(
    runtime: Runtime, job_id: str, sequence: int, reviewer: dict[str, Any]
) -> tuple[list[dict[str, Any]], str]:
    with runtime.engine.connect() as connection:
        job = get_one(connection, t.jobs, t.jobs.c.id == job_id)
        runtime.report_for(connection, job["report_id"], reviewer)
        rows = connection.execute(
            select(t.job_events)
            .where(t.job_events.c.job_id == job_id, t.job_events.c.seq > sequence)
            .order_by(t.job_events.c.seq)
            .limit(100)
        ).mappings()
        return [dict(row) for row in rows], job["status"]


def public_job(connection: Connection, job: dict[str, Any]) -> dict[str, Any]:
    fields = (
        "report_id",
        "kind",
        "status",
        "attempts",
        "max_attempts",
        "lease_expires_at",
        "created_at",
        "updated_at",
        "last_error",
        "summary_json",
    )
    events = connection.execute(
        select(t.job_events).where(t.job_events.c.job_id == job["id"]).order_by(t.job_events.c.seq)
    ).mappings()
    return {
        "job_id": job["id"],
        **{key: job.get(key) for key in fields},
        "events": [dict(row) for row in events],
    }
