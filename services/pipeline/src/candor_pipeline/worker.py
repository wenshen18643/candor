import asyncio
import json
import os
from typing import Any

import httpx
import typer

from candor_pipeline.contracts import StageEvent, Strict
from candor_pipeline.crypto import (
    AnalysisEnvelope,
    ReviewerKey,
    seal_findings,
    unb64u,
    unseal_analysis,
)
from candor_pipeline.dag import DAGRunner, PipelineError
from candor_pipeline.providers.base import ProviderError


class Job(Strict):
    job_id: str
    report_id: str
    attempt: int
    analysis: AnalysisEnvelope
    reviewers: list[ReviewerKey]


class Worker:
    def __init__(
        self, client: httpx.AsyncClient, private_key: bytes, runner: DAGRunner | None = None
    ) -> None:
        self.client = client
        self.private_key = private_key
        self.runner = runner or DAGRunner()

    async def post(self, path: str, data: dict[str, Any]) -> None:
        response = await self.client.post(path, json=data)
        response.raise_for_status()

    async def once(self) -> bool:
        response = await self.client.post("/internal/jobs/claim")
        if response.status_code == 204:
            return False
        response.raise_for_status()
        job = Job.model_validate(response.json())
        try:
            payload = unseal_analysis(job.analysis, self.private_key, job.report_id)

            async def event_callback(event: StageEvent) -> None:
                await self.post(
                    f"/internal/jobs/{job.job_id}/events", event.model_dump(mode="json")
                )

            result = await self.runner.run(payload, event_callback, job_id=job.job_id)
            findings = seal_findings(result, job.reviewers)
            summary = {
                "stages": [
                    stage.model_dump(
                        mode="json",
                        include={
                            "stage",
                            "status",
                            "duration_ms",
                            "llm_calls",
                            "cost_usd",
                            "provider",
                            "model",
                        },
                    )
                    for stage in result.stages
                ],
                "metrics": result.metrics.model_dump(),
            }
            await self.post(
                f"/internal/jobs/{job.job_id}/complete",
                {"findings": findings.model_dump(), "summary": summary},
            )
        except Exception as error:
            retryable = (
                isinstance(error, (httpx.TransportError,))
                or (isinstance(error, (ProviderError, PipelineError)) and error.retryable)
                or (
                    isinstance(error, httpx.HTTPStatusError)
                    and (
                        error.response.status_code >= 500
                        or error.response.status_code in {408, 429}
                    )
                )
            )
            await self.post(
                f"/internal/jobs/{job.job_id}/fail",
                {"error": "analysis_failed", "retryable": retryable},
            )
        return True

    async def run(self, once: bool = False) -> None:
        while True:
            try:
                found = await self.once()
            except (httpx.HTTPError, ValueError):
                print(json.dumps({"event": "worker_poll_failed"}))
                if once:
                    raise RuntimeError("worker_poll_failed") from None
                found = False
            if once:
                return
            if not found:
                await asyncio.sleep(1.5)


async def serve(once: bool) -> None:
    key = unb64u(os.environ["CANDOR_ENCLAVE_SK"])
    async with httpx.AsyncClient(
        base_url=os.getenv("CANDOR_API_URL", "http://localhost:8000"),
        headers={"Authorization": "Bearer " + os.environ["CANDOR_WORKER_TOKEN"]},
        timeout=30,
    ) as client:
        await Worker(client, key).run(once)


def worker_command(once: bool = False) -> None:
    try:
        asyncio.run(serve(once))
    except Exception:
        typer.echo('{"event":"worker_failed"}', err=True)
        raise typer.Exit(1) from None


def main() -> None:
    typer.run(worker_command)
