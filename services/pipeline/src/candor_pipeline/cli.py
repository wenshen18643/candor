import asyncio
import hashlib
import json
import secrets
from pathlib import Path

import typer

from candor_pipeline.config import PipelineConfig
from candor_pipeline.contracts import AnalysisPayload, StageEvent
from candor_pipeline.dag import DAGRunner
from candor_pipeline.providers.registry import build_provider
from candor_pipeline.providers.replay import ReplayProvider
from candor_pipeline.router import Router

app = typer.Typer(pretty_exceptions_enable=False)


async def trace_events(event: StageEvent) -> None:
    typer.echo(event.model_dump_json(exclude={"job_id"}), err=True)


@app.command()
def run(
    payload: Path,
    provider: str | None = None,
    output: Path | None = None,
    samples: int = 3,
    router: Path | None = None,
    record: Path | None = None,
    synthetic: bool = False,
    nonce: str | None = None,
    trace: bool = False,
) -> None:
    try:
        if trace and not synthetic:
            raise ValueError("trace_requires_synthetic_flag")
        if (record or output or nonce) and not synthetic:
            raise ValueError("plaintext_output_requires_synthetic_flag")
        data = AnalysisPayload.model_validate_json(payload.read_bytes())
        selected = build_provider(provider)
        fingerprint = hashlib.sha256(data.model_dump_json().encode()).hexdigest()
        if isinstance(selected, ReplayProvider) and nonce is None:
            manifest_path = selected.directory / "run.json"
            if manifest_path.is_file():
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                if manifest["payload_sha256"] != fingerprint or manifest["samples"] != samples:
                    raise ValueError("replay_run_mismatch")
                nonce = manifest["nonce"]
        if record and nonce is None and (record / "run.json").is_file():
            manifest = json.loads((record / "run.json").read_text(encoding="utf-8"))
            if manifest["payload_sha256"] == fingerprint and manifest["samples"] == samples:
                nonce = manifest["nonce"]
        if record:
            nonce = nonce or secrets.token_hex(16)
            selected = ReplayProvider(record, selected, "record", synthetic=synthetic)
        routing = Router.from_file(router, selected) if router else Router(selected)
        result = asyncio.run(
            DAGRunner(config=PipelineConfig(samples=samples), router=routing).run(
                data, trace_events if trace else None, nonce=nonce
            )
        )
        if output:
            output.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        if record:
            manifest = {
                "source": provider or "environment",
                "synthetic": True,
                "payload_sha256": fingerprint,
                "samples": samples,
                "nonce": nonce,
            }
            (record / "run.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        typer.echo(json.dumps({"event": "analysis_completed", **result.metrics.model_dump()}))
    except Exception as error:
        detail = {"event": "analysis_failed"}
        if trace:
            detail["error"] = f"{type(error).__name__}: {error}"
        typer.echo(json.dumps(detail, separators=(",", ":")), err=True)
        raise typer.Exit(1) from None


@app.command()
def health() -> None:
    typer.echo('{"status":"ok","service":"candor-pipeline"}')


if __name__ == "__main__":
    app()
