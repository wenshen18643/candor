from datetime import timedelta
from typing import Any

from sqlalchemy import Connection, func, select

from candor_api import tables as t
from candor_api.auth import verify_signature
from candor_api.common import now, require, stamp, uid
from candor_api.runtime import Runtime, get_many, get_one
from candor_api.schemas import Approval


def expire(connection: Connection) -> None:
    connection.execute(
        t.access_requests.update()
        .where(t.access_requests.c.status == "pending", t.access_requests.c.expires_at <= stamp())
        .values(status="expired")
    )


def create(
    runtime: Runtime, report_id: str, reviewer: dict[str, Any], reason: str
) -> dict[str, Any]:
    with runtime.write() as connection:
        report = runtime.report_for(connection, report_id, reviewer)
        campaign = get_one(connection, t.campaigns, t.campaigns.c.id == report["campaign_id"])
        request = {
            "id": uid(),
            "report_id": report_id,
            "requester_id": reviewer["id"],
            "reason": reason,
            "status": "granted" if campaign["threshold"] == 1 else "pending",
            "created_at": stamp(),
            "expires_at": stamp(now() + timedelta(days=1)),
        }
        connection.execute(t.access_requests.insert().values(**request))
        runtime.emit(
            connection,
            "access.requested",
            request_id=request["id"],
            report_id=report_id,
            requester_id=reviewer["id"],
        )
        if request["status"] == "granted":
            runtime.emit(connection, "access.granted", request_id=request["id"])
    return request


def approve(
    runtime: Runtime, request_id: str, reviewer: dict[str, Any], approval: Approval
) -> dict[str, Any]:
    with runtime.write() as connection:
        expire(connection)
        request = get_one(connection, t.access_requests, t.access_requests.c.id == request_id)
        report = runtime.report_for(connection, request["report_id"], reviewer)
        require(
            request["requester_id"] != reviewer["id"],
            403,
            "self_approval",
            "Requester cannot approve own request",
        )
        require(
            request["status"] == "pending",
            409,
            "request_closed",
            "Access request is no longer pending",
        )
        get_one(
            connection,
            t.key_shares,
            t.key_shares.c.report_id == report["id"],
            t.key_shares.c.reviewer_id == reviewer["id"],
        )
        message = (
            f"candor/v1/approve\n{request_id}\n{report['id']}\n{request['requester_id']}".encode()
        )
        verify_signature(reviewer["sig_pk"], approval.signature, message)
        require(
            not connection.execute(
                select(t.access_approvals).where(
                    t.access_approvals.c.request_id == request_id,
                    t.access_approvals.c.approver_id == reviewer["id"],
                )
            ).first(),
            409,
            "already_approved",
            "Reviewer already approved",
        )
        connection.execute(
            t.access_approvals.insert().values(
                request_id=request_id,
                approver_id=reviewer["id"],
                **approval.model_dump(),
                created_at=stamp(),
            )
        )
        runtime.emit(
            connection, "access.approved", request_id=request_id, approver_id=reviewer["id"]
        )
        campaign = get_one(connection, t.campaigns, t.campaigns.c.id == report["campaign_id"])
        count = connection.execute(
            select(func.count())
            .select_from(t.access_approvals)
            .where(t.access_approvals.c.request_id == request_id)
        ).scalar_one()
        if count >= campaign["threshold"] - 1:
            request["status"] = "granted"
            connection.execute(
                t.access_requests.update()
                .where(t.access_requests.c.id == request_id)
                .values(status="granted")
            )
            runtime.emit(connection, "access.granted", request_id=request_id)
        return request


def detail(runtime: Runtime, request_id: str, reviewer: dict[str, Any]) -> dict[str, Any]:
    with runtime.write() as connection:
        expire(connection)
        request = get_one(
            connection,
            t.access_requests,
            t.access_requests.c.id == request_id,
            t.access_requests.c.requester_id == reviewer["id"],
        )
        runtime.report_for(connection, request["report_id"], reviewer)
        share = get_one(
            connection,
            t.key_shares,
            t.key_shares.c.report_id == request["report_id"],
            t.key_shares.c.reviewer_id == reviewer["id"],
        )
        return {
            **request,
            "sealed_share": share["sealed_share"],
            "resealed_shares": get_many(
                connection, t.access_approvals, t.access_approvals.c.request_id == request_id
            )
            if request["status"] == "granted"
            else [],
        }


def list_requests(runtime: Runtime, reviewer: dict[str, Any], status: str) -> list[dict[str, Any]]:
    with runtime.write() as connection:
        expire(connection)
        rows = connection.execute(
            select(t.access_requests)
            .join(t.reports, t.reports.c.id == t.access_requests.c.report_id)
            .where(t.reports.c.org_id == reviewer["org_id"], t.access_requests.c.status == status)
        ).mappings()
        result = []
        for row in rows:
            requester = get_one(connection, t.reviewers, t.reviewers.c.id == row["requester_id"])
            approvals = get_many(
                connection, t.access_approvals, t.access_approvals.c.request_id == row["id"]
            )
            result.append(
                {
                    **row,
                    "requester_enc_pk": requester["enc_pk"],
                    "approvals": [
                        {"approver_id": item["approver_id"], "created_at": item["created_at"]}
                        for item in approvals
                    ],
                }
            )
        return result
