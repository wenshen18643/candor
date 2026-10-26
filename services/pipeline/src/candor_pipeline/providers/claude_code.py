import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from candor_pipeline.providers.anthropic_api import sample_prompt
from candor_pipeline.providers.base import LLMRequest, LLMResponse, ProviderError, Usage

NESTED_SESSION = {"CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT"}


def executable_command() -> list[str]:
    executable = shutil.which("claude.exe") or shutil.which("claude")
    if not executable:
        raise ProviderError("claude_not_installed")
    return [executable]


class ClaudeCodeProvider:
    def __init__(
        self,
        model: str = "claude-haiku-5-5",
        concurrency: int = 4,
        timeout: float = 300,
        effort: str = "low",
    ) -> None:
        self.model = model
        self.timeout = timeout
        self.effort = effort
        self.semaphore = asyncio.Semaphore(concurrency)

    async def complete_json(self, request: LLMRequest) -> LLMResponse:
        async with self.semaphore:
            task = asyncio.create_task(asyncio.to_thread(self._complete, request))
            try:
                return await asyncio.shield(task)
            except asyncio.CancelledError:
                await asyncio.gather(task, return_exceptions=True)
                raise

    def command(self, request: LLMRequest) -> list[str]:
        return [
            *executable_command(),
            "-p",
            "--model",
            self.model,
            "--effort",
            self.effort,
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(request.json_schema, separators=(",", ":")),
            "--system-prompt",
            request.system,
            "--tools",
            "",
            "--strict-mcp-config",
            "--setting-sources",
            "",
            "--disable-slash-commands",
            "--no-session-persistence",
        ]

    def _complete(self, request: LLMRequest) -> LLMResponse:
        started = time.monotonic()
        command = self.command(request)
        directory = Path(tempfile.gettempdir()) / ("candor-claude-" + uuid.uuid4().hex)
        directory.mkdir()
        environment = {key: value for key, value in os.environ.items() if key not in NESTED_SESSION}
        try:
            result = subprocess.run(
                command,
                input=sample_prompt(request).encode("utf-8"),
                capture_output=True,
                timeout=self.timeout,
                check=False,
                cwd=directory,
                env=environment,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except subprocess.TimeoutExpired:
            raise ProviderError("claude_timeout", retryable=True) from None
        except OSError:
            raise ProviderError("claude_launch_failed") from None
        finally:
            directory.rmdir()
        if result.returncode and not result.stdout.strip():
            raise ProviderError("claude_execution_failed", retryable=True)
        text, usage = parse_result(result.stdout)
        return LLMResponse(
            text=text,
            usage=usage,
            provider="claude",
            model=self.model,
            latency_ms=int((time.monotonic() - started) * 1000),
        )


def parse_result(output: bytes) -> tuple[str, Usage]:
    try:
        event = json.loads(output.decode("utf-8"))
    except (ValueError, UnicodeError):
        raise ProviderError("claude_invalid_output") from None
    if not isinstance(event, dict) or event.get("type") != "result":
        raise ProviderError("claude_invalid_output")
    if event.get("is_error") or event.get("subtype") != "success":
        status = event.get("api_error_status")
        retryable = not isinstance(status, int) or status == 429 or status >= 500
        raise ProviderError("claude_turn_failed", retryable)
    data = event.get("structured_output")
    if not isinstance(data, dict):
        raise ProviderError("claude_incomplete_response", True)
    counts = event.get("usage") or {}
    return json.dumps(data, ensure_ascii=False), Usage(
        input_tokens=sum(
            counts.get(key) or 0
            for key in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
        ),
        output_tokens=counts.get("output_tokens") or 0,
        cost_usd=event.get("total_cost_usd") or 0,
    )
