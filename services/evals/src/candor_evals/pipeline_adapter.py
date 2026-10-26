from __future__ import annotations

import hashlib
import importlib
import os
import shutil
from pathlib import Path
from typing import Protocol

from candor_pipeline.contracts import AnalysisPayload, AnalysisResult
from pydantic import ValidationError

from candor_evals.models import PipelineRun, RunOptions


class PipelineUnavailableError(RuntimeError):
    pass


class PipelineAdapter(Protocol):
    async def run(self, payload: AnalysisPayload, options: RunOptions) -> PipelineRun: ...


def missing_credentials(spec: str) -> str | None:
    provider, _, model = spec.partition(":")
    if provider == "replay":
        return None if os.getenv("CANDOR_REPLAY_DIR") else "CANDOR_REPLAY_DIR is not configured"
    if provider == "claude":
        return (
            None
            if os.getenv("ANTHROPIC_API_KEY", "").strip() or shutil.which("claude")
            else "ANTHROPIC_API_KEY is not configured and Claude Code is unavailable"
        )
    if provider == "codex":
        return (
            None if shutil.which("codex") or shutil.which("codex.cmd") else "Codex CLI unavailable"
        )
    variables = {
        "meta": "MODEL_API_KEY",
        "fireworks": "FIREWORKS_API_KEY",
        "baseten": "BASETEN_API_KEY",
    }
    if provider not in variables:
        return "Unknown provider"
    if not os.getenv(variables[provider], "").strip():
        return f"{variables[provider]} is not configured"
    if provider in {"fireworks", "baseten"} and not (
        model or os.getenv(f"CANDOR_{provider.upper()}_MODEL")
    ):
        return "Model is not configured"
    return None


def provider_model(spec: str) -> tuple[str, str]:
    provider, _, model = spec.partition(":")
    defaults = {
        "claude": "claude-haiku-5-5",
        "codex": "gpt-6.1-sol",
        "meta": "muse-spark-1.3",
        "replay": "cassette",
    }
    return provider, model or os.getenv(
        f"CANDOR_{provider.upper()}_MODEL", defaults.get(provider, "")
    )


class RealPipelineAdapter:
    def __init__(self, cassette_directory: Path) -> None:
        self.cassette_directory = cassette_directory.resolve()

    async def run(self, payload: AnalysisPayload, options: RunOptions) -> PipelineRun:
        try:
            dag = importlib.import_module("candor_pipeline.dag")
            registry = importlib.import_module("candor_pipeline.providers.registry")
            tap_module = importlib.import_module("candor_pipeline.providers.tap")
            chaos_module = importlib.import_module("candor_pipeline.providers.chaos")
            replay_module = importlib.import_module("candor_pipeline.providers.replay")
        except ImportError:
            raise PipelineUnavailableError("Pipeline public entry points are unavailable") from None
        if options.provider.split(":")[0] == "replay":
            inner = replay_module.ReplayProvider(
                Path(os.getenv("CANDOR_REPLAY_DIR", str(self.cassette_directory)))
            )
        else:
            inner = registry.build_provider(options.provider)
        if options.record:
            if options.provider.split(":")[0] == "replay":
                raise ValueError("Record mode needs a live source provider")
            inner = replay_module.ReplayProvider(
                Path(os.getenv("CANDOR_REPLAY_DIR", str(self.cassette_directory))),
                mode="record",
                inner=inner,
                synthetic=True,
            )
        if options.chaos:
            inner = chaos_module.ChaosProvider(inner, p=options.chaos, seed=options.seed)
        tap = tap_module.TapProvider(inner)
        try:
            nonce = hashlib.sha256(
                f"{options.seed}:{payload.model_dump_json()}".encode()
            ).hexdigest()[:32]
            runner = dag.DAGRunner(provider=tap, config=dag.PipelineConfig(samples=options.samples))
            result = await runner.run(payload, nonce=nonce)
            validated = AnalysisResult.model_validate(
                result.model_dump(mode="json") if isinstance(result, AnalysisResult) else result
            )
            return PipelineRun(result=validated, prompts=self._prompts(tap))
        except ValidationError:
            return PipelineRun(
                failure="invalid_result_schema", schema_valid=False, prompts=self._prompts(tap)
            )
        except Exception:
            return PipelineRun(failure="pipeline_execution_failed", prompts=self._prompts(tap))

    @staticmethod
    def _prompts(tap: object) -> list[str]:
        return [f"{request.system}\n{request.user}" for request in getattr(tap, "requests", [])]
