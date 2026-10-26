import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from candor_pipeline.providers.base import LLMRequest, LLMResponse, ProviderError, Usage


def executable_command() -> list[str]:
    executable = shutil.which("codex.exe") or shutil.which("codex")
    if not executable:
        raise ProviderError("codex_not_installed")
    path = Path(executable)
    if os.name == "nt" and path.suffix.lower() in {".cmd", ".ps1", ".bat"}:
        package = path.parent / "node_modules" / "@openai" / "codex"
        binaries = sorted(package.glob("**/codex.exe"))
        if binaries:
            return [str(binaries[0])]
        raise ProviderError("codex_executable_not_found")
    return [executable]


class CodexCLIProvider:
    def __init__(
        self, model: str = "gpt-6.1-sol", concurrency: int = 2, timeout: float = 600
    ) -> None:
        self.model = model
        self.timeout = timeout
        self.semaphore = asyncio.Semaphore(concurrency)

    async def complete_json(self, request: LLMRequest) -> LLMResponse:
        async with self.semaphore:
            task = asyncio.create_task(asyncio.to_thread(self._complete, request))
            try:
                return await asyncio.shield(task)
            except asyncio.CancelledError:
                await asyncio.gather(task, return_exceptions=True)
                raise

    def _complete(self, request: LLMRequest) -> LLMResponse:
        started = time.monotonic()
        directory = Path(tempfile.gettempdir()) / ("candor-schema-" + uuid.uuid4().hex)
        directory.mkdir()
        try:
            schema_path = Path(directory) / "schema.json"
            schema_path.write_text(json.dumps(request.json_schema), encoding="utf-8")
            command = [
                *executable_command(),
                "exec",
                "-m",
                self.model,
                "--output-schema",
                str(schema_path),
                "--ephemeral",
                "--skip-git-repo-check",
                "--ignore-user-config",
                "-s",
                "read-only",
                "-C",
                str(directory),
                "--color",
                "never",
                "-c",
                'model_reasoning_effort="low"',
                "--disable",
                "shell_tool",
                "--disable",
                "apps",
                "--disable",
                "plugins",
                "--disable",
                "multi_agent",
                "-c",
                'web_search="disabled"',
                "--json",
                "-",
            ]
            prompt = (
                "Answer directly with JSON. Do not run commands, use tools, "
                "browse, or read files.\n"
                + request.system
                + f"\nIndependent extraction sample {request.sample_index}.\n"
                + request.user
            )
            try:
                result = subprocess.run(
                    command,
                    input=prompt.encode("utf-8"),
                    capture_output=True,
                    timeout=self.timeout,
                    check=False,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
            except subprocess.TimeoutExpired:
                raise ProviderError("codex_timeout", retryable=True) from None
            except OSError:
                raise ProviderError("codex_launch_failed") from None
            if result.returncode:
                raise ProviderError("codex_execution_failed", retryable=True)
            text, usage = parse_events(result.stdout)
            return LLMResponse(
                text=text,
                usage=usage,
                provider="codex",
                model=self.model,
                latency_ms=int((time.monotonic() - started) * 1000),
            )
        finally:
            schema_path.unlink(missing_ok=True)
            directory.rmdir()


def parse_events(output: bytes) -> tuple[str, Usage]:
    answer = ""
    completed = False
    usage = Usage()
    try:
        for line in output.decode("utf-8").splitlines():
            event = json.loads(line)
            kind = event.get("type", "")
            if kind in {"error", "turn.failed"}:
                raise ProviderError("codex_turn_failed", True)
            if kind.startswith("item."):
                item = event.get("item", {})
                if item.get("type") == "error":
                    continue
                if item.get("type") not in {"reasoning", "agent_message"}:
                    raise ProviderError("codex_unexpected_tool_activity")
                if kind == "item.completed" and item.get("type") == "agent_message":
                    answer = item.get("text", "")
            if kind == "turn.completed":
                completed = True
                counts = event.get("usage") or {}
                usage = Usage(
                    input_tokens=counts.get("input_tokens", 0),
                    output_tokens=counts.get("output_tokens", 0),
                )
    except (ValueError, UnicodeError, AttributeError):
        raise ProviderError("codex_invalid_event_stream") from None
    if not completed or not answer:
        raise ProviderError("codex_incomplete_response", True)
    return answer, usage
