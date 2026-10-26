import asyncio
import hmac
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any

from candor_pipeline.contracts import StageEvent
from fastapi import Depends, FastAPI, Header, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sse_starlette import EventSourceResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException

from candor_api import auth, custody, jobs, reports
from candor_api import responses as wire
from candor_api import tables as t
from candor_api.common import ApiError, b64u, require, stamp, uid
from candor_api.merkle import leaf_hash
from candor_api.middleware import GuardMiddleware, TokenBuckets
from candor_api.payments import receipt_header
from candor_api.runtime import Runtime, get_many, get_one
from candor_api.schemas import (
    AccessRequest,
    Approval,
    Completion,
    Failure,
    InboxChallenge,
    InboxLogin,
    InboxMessage,
    ReportStatus,
    ReviewerChallenge,
    ReviewerLogin,
    ReviewerMessage,
    StatusChange,
    Submission,
)
from candor_api.settings import Settings

bearer = HTTPBearer(auto_error=False)


def runtime_for(request: Request) -> Runtime:
    return request.app.state.runtime


RuntimeDep = Annotated[Runtime, Depends(runtime_for)]
Credentials = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


def bearer_token(credentials: HTTPAuthorizationCredentials | None) -> str:
    require(credentials is not None, 401, "unauthorized", "Bearer authentication required")
    return credentials.credentials


def reviewer_for(runtime: RuntimeDep, credentials: Credentials) -> dict[str, Any]:
    return auth.reviewer_for(runtime, bearer_token(credentials))


ReviewerDep = Annotated[dict[str, Any], Depends(reviewer_for)]


def admin_for(reviewer: ReviewerDep) -> dict[str, Any]:
    require(reviewer["role"] == "admin", 403, "forbidden", "Administrator role required")
    return reviewer


AdminDep = Annotated[dict[str, Any], Depends(admin_for)]


def inbox_for(runtime: RuntimeDep, credentials: Credentials) -> dict[str, Any]:
    return auth.decode(runtime, bearer_token(credentials), "inbox")


InboxDep = Annotated[dict[str, Any], Depends(inbox_for)]


def worker_for(runtime: RuntimeDep, credentials: Credentials) -> None:
    token = runtime.settings.candor_worker_token.get_secret_value()
    require(
        bool(token) and hmac.compare_digest(bearer_token(credentials), token),
        401,
        "unauthorized",
        "Worker authentication required",
    )


WorkerDep = Annotated[None, Depends(worker_for)]
Attempt = Annotated[int | None, Header(alias="X-Job-Attempt", ge=1)]


def create_app(settings: Settings | None = None, runtime: Runtime | None = None) -> FastAPI:
    configured = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.runtime = runtime or await run_in_threadpool(Runtime, configured)
        yield
        if runtime is None:
            await run_in_threadpool(app.state.runtime.close)

    app = FastAPI(
        title="Candor Report API",
        version="0.1.0",
        lifespan=lifespan,
        responses={
            code: {"model": wire.ErrorResponse}
            for code in (400, 401, 403, 404, 409, 413, 422, 429, 500, 503)
        },
    )
    if runtime:
        app.state.runtime = runtime
    app.state.buckets = TokenBuckets()
    app.add_middleware(GuardMiddleware, buckets=app.state.buckets)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[configured.candor_web_url],
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-PAYMENT",
            "Idempotency-Key",
            "Last-Event-ID",
        ],
        expose_headers=["X-PAYMENT-RESPONSE", "Retry-After"],
    )
    install_errors(app)
    install_public(app)
    install_reviewers(app)
    install_jobs(app)
    install_custody(app)
    install_inbox(app)
    install_log(app)
    install_admin(app)
    return app


def install_errors(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": error.code, "message": error.message}}, status_code=error.status
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            {
                "error": {
                    "code": "invalid_request",
                    "message": "Request does not match the required schema",
                }
            },
            status_code=422,
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": "http_error", "message": "Request could not be processed"}},
            status_code=error.status_code,
        )

    @app.exception_handler(IntegrityError)
    async def conflict(request: Request, error: IntegrityError) -> JSONResponse:
        return JSONResponse(
            {
                "error": {
                    "code": "conflict",
                    "message": "Resource conflicts with an existing record",
                }
            },
            status_code=409,
        )

    @app.exception_handler(Exception)
    async def unexpected(request: Request, error: Exception) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": "internal_error", "message": "Request could not be completed"}},
            status_code=500,
        )


def install_public(app: FastAPI) -> None:
    @app.get("/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/v1/campaigns/{campaign_id}", response_model=wire.CampaignDescriptor)
    def campaign(campaign_id: str, runtime: RuntimeDep) -> dict[str, Any]:
        return reports.descriptor(runtime, campaign_id)

    @app.post("/v1/reports", status_code=201, response_model=wire.Submitted)
    def submit(value: Submission, runtime: RuntimeDep) -> dict[str, Any]:
        return reports.submit(runtime, value)

    @app.post("/v1/chaff", status_code=204)
    def chaff() -> Response:
        return Response(status_code=204)

    @app.get("/v1/enclave", response_model=wire.EnclavePublic)
    def enclave(runtime: RuntimeDep) -> dict[str, str]:
        return runtime.enclave()

    @app.get("/v1/demo/identities")
    def identities(runtime: RuntimeDep) -> Any:
        require(runtime.settings.candor_mode == "demo", 404, "not_found", "Resource not found")
        path = runtime.settings.candor_data_dir / "demo" / "identities.json"
        require(path.exists(), 404, "not_found", "Demo identities have not been seeded")
        return json.loads(path.read_text())

    @app.post("/v1/auth/challenge", response_model=wire.Challenge)
    def reviewer_challenge(value: ReviewerChallenge, runtime: RuntimeDep) -> dict[str, str]:
        return auth.challenge(runtime, value.reviewer_id, "reviewer")

    @app.post("/v1/auth/token", response_model=wire.ReviewerSession)
    def reviewer_token(value: ReviewerLogin, runtime: RuntimeDep) -> dict[str, Any]:
        return auth.login(runtime, value.reviewer_id, value.challenge, value.signature, "reviewer")


def install_reviewers(app: FastAPI) -> None:
    @app.get("/v1/me")
    def me(runtime: RuntimeDep, reviewer: ReviewerDep) -> dict[str, Any]:
        with runtime.engine.connect() as connection:
            return {
                **reviewer,
                "reviewer_id": reviewer["id"],
                "org": get_one(connection, t.orgs, t.orgs.c.id == reviewer["org_id"]),
            }

    @app.get("/v1/reports", response_model=list[wire.ReportSummary])
    def list_reports(
        runtime: RuntimeDep, reviewer: ReviewerDep, status: ReportStatus | None = None
    ) -> list[dict[str, Any]]:
        with runtime.engine.connect() as connection:
            query = select(t.reports).where(t.reports.c.org_id == reviewer["org_id"])
            if status:
                query = query.where(t.reports.c.status == status)
            rows = connection.execute(query.order_by(t.reports.c.received_bucket.desc())).mappings()
            return [reports.report_summary(connection, dict(row), reviewer["id"]) for row in rows]

    @app.get("/v1/reports/{report_id}", response_model=wire.ReportDetail)
    def report_detail(report_id: str, runtime: RuntimeDep, reviewer: ReviewerDep) -> dict[str, Any]:
        return reports.detail(runtime, report_id, reviewer)

    @app.get("/v1/reports/{report_id}/files/{index}", response_model=wire.FileResponse)
    def file(
        report_id: str, index: int, runtime: RuntimeDep, reviewer: ReviewerDep
    ) -> dict[str, Any]:
        return reports.file_box(runtime, report_id, index, reviewer)

    @app.patch("/v1/reports/{report_id}")
    def change_status(
        report_id: str, value: StatusChange, runtime: RuntimeDep, reviewer: ReviewerDep
    ) -> dict[str, str]:
        with runtime.write() as connection:
            runtime.report_for(connection, report_id, reviewer)
            connection.execute(
                t.reports.update().where(t.reports.c.id == report_id).values(status=value.status)
            )
            runtime.emit(
                connection,
                "report.status_changed",
                report_id=report_id,
                status=value.status,
                actor=reviewer["id"],
            )
        return {"report_id": report_id, "status": value.status}

    @app.post("/v1/reports/{report_id}/messages", status_code=201)
    def message(
        report_id: str, value: ReviewerMessage, runtime: RuntimeDep, reviewer: ReviewerDep
    ) -> dict[str, str]:
        message_id = uid()
        with runtime.write() as connection:
            runtime.report_for(connection, report_id, reviewer)
            connection.execute(
                t.messages.insert().values(
                    id=message_id,
                    report_id=report_id,
                    direction="to_reporter",
                    sender_reviewer_id=reviewer["id"],
                    boxes_json=value.box.model_dump(),
                    created_at=stamp(),
                )
            )
            runtime.emit(connection, "message.sent", report_id=report_id, direction="to_reporter")
        return {"id": message_id}


def install_jobs(app: FastAPI) -> None:
    @app.post(
        "/v1/reports/{report_id}/analysis",
        status_code=202,
        response_model=wire.JobAccepted,
        responses={402: {"model": wire.PaymentRequired}},
    )
    def analysis(
        report_id: str,
        response: Response,
        runtime: RuntimeDep,
        reviewer: ReviewerDep,
        x_payment: Annotated[str | None, Header()] = None,
        idempotency_key: Annotated[str | None, Header()] = None,
    ) -> Any:
        with runtime.engine.connect() as connection:
            report = runtime.report_for(connection, report_id, reviewer)
            campaign = get_one(connection, t.campaigns, t.campaigns.c.id == report["campaign_id"])
        if idempotency_key:
            existing = jobs.replay(runtime, report_id, reviewer, idempotency_key)
            if existing:
                job, receipt = existing
                response.headers["X-PAYMENT-RESPONSE"] = receipt_header(receipt)
                return job
        if not x_payment:
            requirements = runtime.payments.requirements(
                campaign["analysis_price_usd"],
                f"{runtime.settings.candor_api_url}/v1/reports/{report_id}/analysis",
            )
            return JSONResponse(
                {
                    "x402Version": 1,
                    "error": "X-PAYMENT required",
                    "accepts": [requirements],
                },
                status_code=402,
            )
        payload = runtime.payments.decode(x_payment)
        job, receipt = jobs.enqueue(runtime, report_id, reviewer, payload, idempotency_key)
        response.headers["X-PAYMENT-RESPONSE"] = receipt_header(receipt)
        return job

    @app.get("/v1/jobs/{job_id}", response_model=wire.JobDetail)
    def job_detail(job_id: str, runtime: RuntimeDep, reviewer: ReviewerDep) -> dict[str, Any]:
        with runtime.engine.connect() as connection:
            job = get_one(connection, t.jobs, t.jobs.c.id == job_id)
            runtime.report_for(connection, job["report_id"], reviewer)
            return jobs.public_job(connection, job)

    @app.get(
        "/v1/jobs/{job_id}/events",
        response_class=EventSourceResponse,
        responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
    )
    async def stream(
        job_id: str,
        request: Request,
        runtime: RuntimeDep,
        credentials: Credentials,
        access_token: str | None = None,
        last_event_id: Annotated[str | None, Header()] = None,
    ) -> EventSourceResponse:
        token = credentials.credentials if credentials else access_token or ""
        reviewer = await run_in_threadpool(auth.reviewer_for, runtime, token)
        await run_in_threadpool(job_detail, job_id, runtime, reviewer)
        try:
            cursor = int(last_event_id or "0")
        except ValueError as error:
            raise ApiError(400, "invalid_cursor", "Invalid Last-Event-ID") from error
        require(cursor >= 0, 400, "invalid_cursor", "Invalid Last-Event-ID")

        async def events() -> AsyncIterator[dict[str, str]]:
            sequence = cursor
            while not await request.is_disconnected():
                try:
                    auth.decode(runtime, token, "reviewer")
                except ApiError:
                    yield {"event": "done", "data": '{"status":"auth_expired"}'}
                    return
                rows, status = await run_in_threadpool(jobs.events_after, runtime, job_id, sequence)
                for row in rows:
                    sequence = row["seq"]
                    value = StageEvent.model_validate(
                        {key: value for key, value in row.items() if key not in {"id", "seq"}}
                    )
                    yield {"id": str(sequence), "event": "stage", "data": value.model_dump_json()}
                if status in jobs.TERMINAL:
                    yield {
                        "event": "done",
                        "data": json.dumps({"job_id": job_id, "status": status}),
                    }
                    return
                await asyncio.sleep(0.25)

        return EventSourceResponse(
            events(), ping=15, headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"}
        )

    @app.post(
        "/internal/jobs/claim",
        response_model=wire.ClaimedJob,
        responses={204: {"description": "No queued job is available"}},
    )
    def claim(runtime: RuntimeDep, worker: WorkerDep) -> Any:
        return jobs.claim(runtime) or Response(status_code=204)

    @app.post("/internal/jobs/{job_id}/events", status_code=204)
    def event(
        job_id: str,
        value: StageEvent,
        runtime: RuntimeDep,
        worker: WorkerDep,
        x_job_attempt: Attempt = None,
    ) -> Response:
        jobs.event(runtime, job_id, value, x_job_attempt)
        return Response(status_code=204)

    @app.post("/internal/jobs/{job_id}/complete", status_code=204)
    def complete(
        job_id: str,
        value: Completion,
        runtime: RuntimeDep,
        worker: WorkerDep,
        x_job_attempt: Attempt = None,
    ) -> Response:
        jobs.complete(runtime, job_id, value, x_job_attempt)
        return Response(status_code=204)

    @app.post("/internal/jobs/{job_id}/fail", status_code=204)
    def fail(
        job_id: str,
        value: Failure,
        runtime: RuntimeDep,
        worker: WorkerDep,
        x_job_attempt: Attempt = None,
    ) -> Response:
        jobs.fail(runtime, job_id, value, x_job_attempt)
        return Response(status_code=204)


def install_custody(app: FastAPI) -> None:
    @app.post(
        "/v1/reports/{report_id}/access-requests",
        status_code=201,
        response_model=wire.AccessRequest,
    )
    def create(
        report_id: str, value: AccessRequest, runtime: RuntimeDep, reviewer: ReviewerDep
    ) -> dict[str, Any]:
        return custody.create(runtime, report_id, reviewer, value.reason)

    @app.get("/v1/access-requests", response_model=list[wire.ListedAccess])
    def requests(
        runtime: RuntimeDep, reviewer: ReviewerDep, status: str = "pending"
    ) -> list[dict[str, Any]]:
        require(
            status in {"pending", "granted", "expired", "denied"},
            422,
            "invalid_status",
            "Invalid access status",
        )
        return custody.list_requests(runtime, reviewer, status)

    @app.post("/v1/access-requests/{request_id}/approve", response_model=wire.AccessRequest)
    def approve(
        request_id: str, value: Approval, runtime: RuntimeDep, reviewer: ReviewerDep
    ) -> dict[str, Any]:
        return custody.approve(runtime, request_id, reviewer, value)

    @app.get("/v1/access-requests/{request_id}", response_model=wire.AccessDetail)
    def detail(request_id: str, runtime: RuntimeDep, reviewer: ReviewerDep) -> dict[str, Any]:
        return custody.detail(runtime, request_id, reviewer)


def install_inbox(app: FastAPI) -> None:
    @app.post("/v1/inbox/challenge", response_model=wire.Challenge)
    def challenge(value: InboxChallenge, runtime: RuntimeDep) -> dict[str, str]:
        return auth.challenge(runtime, value.sig_pk, "inbox")

    @app.post("/v1/inbox/session", response_model=wire.InboxSession)
    def session(value: InboxLogin, runtime: RuntimeDep) -> dict[str, Any]:
        return auth.login(runtime, value.sig_pk, value.challenge, value.signature, "inbox")

    @app.get("/v1/inbox/messages", response_model=wire.InboxMessages)
    def messages(runtime: RuntimeDep, inbox: InboxDep) -> dict[str, Any]:
        with runtime.engine.connect() as connection:
            rows = get_many(
                connection,
                t.reports,
                t.reports.c.inbox_sig_pk == inbox["sub"],
                t.reports.c.id.in_(inbox["reports"]),
            )
            return {
                "reports": [
                    {
                        "report_id": row["id"],
                        "status": row["status"],
                        "messages": reports.visible_messages(connection, row["id"], None),
                    }
                    for row in rows
                ]
            }

    @app.post("/v1/inbox/messages", status_code=201)
    def reply(value: InboxMessage, runtime: RuntimeDep, inbox: InboxDep) -> dict[str, str]:
        require(
            value.report_id in inbox["reports"],
            403,
            "forbidden",
            "Report is outside this inbox session",
        )
        message_id = uid()
        with runtime.write() as connection:
            report = get_one(
                connection,
                t.reports,
                t.reports.c.id == value.report_id,
                t.reports.c.inbox_sig_pk == inbox["sub"],
            )
            runtime.validate_recipients(
                connection, report["org_id"], [box.reviewer_id for box in value.boxes]
            )
            connection.execute(
                t.messages.insert().values(
                    id=message_id,
                    report_id=value.report_id,
                    direction="to_reviewers",
                    sender_reviewer_id=None,
                    boxes_json=[box.model_dump() for box in value.boxes],
                    created_at=stamp(),
                )
            )
            runtime.emit(
                connection, "message.sent", report_id=value.report_id, direction="to_reviewers"
            )
        return {"id": message_id}


def install_log(app: FastAPI) -> None:
    @app.get("/v1/log/key")
    def key(runtime: RuntimeDep) -> dict[str, str]:
        return {
            "key_id": runtime.audit.key_id,
            "public_key": b64u(bytes(runtime.audit.signing_key.verify_key)),
        }

    @app.get("/v1/log/sth", response_model=wire.SignedTreeHead)
    def sth(runtime: RuntimeDep) -> dict[str, Any]:
        return runtime.audit.latest()

    @app.get("/v1/log/entries", response_model=list[wire.LogEntry])
    def entries(runtime: RuntimeDep, start: int = 0, end: int = 100) -> list[dict[str, Any]]:
        return runtime.audit.read_entries(start, end)

    @app.get("/v1/log/proofs/inclusion")
    def inclusion(runtime: RuntimeDep, index: int, tree_size: int) -> dict[str, Any]:
        proof = runtime.audit.proof("inclusion", index, tree_size)
        return {
            "index": index,
            "tree_size": tree_size,
            "leaf_hash": leaf_hash(runtime.audit.tree.leaves[index]).hex(),
            "audit_path": proof,
        }

    @app.get("/v1/log/proofs/consistency")
    def consistency(runtime: RuntimeDep, first: int, second: int) -> dict[str, Any]:
        return {
            "first": first,
            "second": second,
            "proof": runtime.audit.proof("consistency", first, second),
        }

    @app.get("/v1/log/anchors", response_model=list[wire.Anchor])
    def anchors(runtime: RuntimeDep) -> list[dict[str, Any]]:
        return runtime.audit.list_anchors()


def install_admin(app: FastAPI) -> None:
    @app.get("/v1/admin/jobs", response_model=list[wire.JobDetail])
    def admin_jobs(
        runtime: RuntimeDep, admin: AdminDep, status: str = "dead"
    ) -> list[dict[str, Any]]:
        with runtime.engine.connect() as connection:
            rows = connection.execute(
                select(t.jobs)
                .join(t.reports, t.reports.c.id == t.jobs.c.report_id)
                .where(t.reports.c.org_id == admin["org_id"], t.jobs.c.status == status)
            ).mappings()
            return [jobs.public_job(connection, dict(row)) for row in rows]

    @app.post("/v1/admin/jobs/{job_id}/retry")
    def retry(job_id: str, runtime: RuntimeDep, admin: AdminDep) -> dict[str, str]:
        with runtime.write() as connection:
            job = get_one(connection, t.jobs, t.jobs.c.id == job_id)
            runtime.report_for(connection, job["report_id"], admin)
            require(
                job["status"] in {"dead", "failed"},
                409,
                "invalid_state",
                "Only failed jobs can be retried",
            )
            connection.execute(
                t.jobs.update()
                .where(t.jobs.c.id == job_id)
                .values(
                    status="queued",
                    attempts=0,
                    lease_expires_at=None,
                    updated_at=stamp(),
                    last_error=None,
                )
            )
        return {"job_id": job_id, "status": "queued"}

    @app.post("/v1/admin/anchor", response_model=wire.Anchor | None)
    def anchor(runtime: RuntimeDep, admin: AdminDep) -> dict[str, Any] | None:
        return runtime.audit.anchor()

    @app.get("/v1/admin/payments")
    def payments(runtime: RuntimeDep, admin: AdminDep) -> list[dict[str, Any]]:
        return runtime.payments.summaries()


app = create_app()
