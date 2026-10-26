import json
import subprocess
from pathlib import Path
from typing import Any

import anthropic
import httpx2
import pytest

from candor_pipeline.providers.anthropic_api import AnthropicProvider
from candor_pipeline.providers.base import ProviderError
from candor_pipeline.providers.claude_code import ClaudeCodeProvider, parse_result
from candor_pipeline.providers.registry import build_provider
from tests.test_structured import request


def message(text: str = '{"ok":true}', stop_reason: str = "end_turn") -> dict[str, Any]:
    return {
        "id": "msg_synthetic",
        "type": "message",
        "role": "assistant",
        "model": "claude-haiku-5-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {
            "input_tokens": 100,
            "output_tokens": 50,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 20,
        },
    }


def streamed(body: dict[str, Any]) -> httpx2.Response:
    start = body | {"content": [], "stop_reason": None}
    text = body["content"][0]["text"]
    events = [
        ("message_start", {"type": "message_start", "message": start}),
        (
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "text", "text": ""},
            },
        ),
        *(
            [
                (
                    "content_block_delta",
                    {
                        "type": "content_block_delta",
                        "index": 0,
                        "delta": {"type": "text_delta", "text": text},
                    },
                )
            ]
            if text
            else []
        ),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        (
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": body["stop_reason"], "stop_sequence": None},
                "usage": {"output_tokens": body["usage"]["output_tokens"]},
            },
        ),
        ("message_stop", {"type": "message_stop"}),
    ]
    payload = "".join(f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events)
    return httpx2.Response(
        200, headers={"content-type": "text/event-stream"}, content=payload.encode()
    )


def client(handler: Any) -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(
        api_key="synthetic-credential",
        max_retries=0,
        http_client=anthropic.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(handler)),
    )


async def test_anthropic_wire_contract() -> None:
    bodies: list[dict[str, Any]] = []

    def handler(incoming: httpx2.Request) -> httpx2.Response:
        assert incoming.url.path == "/v1/messages"
        bodies.append(json.loads(incoming.content))
        return streamed(message())

    response = await AnthropicProvider(client=client(handler)).complete_json(request())
    body = bodies[0]
    assert body["model"] == "claude-haiku-5-5"
    assert "temperature" not in body
    assert body["stream"] is True
    assert body["max_tokens"] == 64000
    assert body["output_config"]["effort"] == "low"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["messages"][0]["content"].startswith("Independent extraction sample 0.")
    assert response.text == '{"ok":true}'
    assert response.provider == "claude"
    assert response.usage.input_tokens == 120
    assert response.usage.cost_usd == pytest.approx((120 * 0.10 + 50 * 0.50) / 1e6)


@pytest.mark.parametrize(
    ("status", "code", "retryable"),
    [
        (429, "claude_unavailable", True),
        (529, "claude_unavailable", True),
        (400, "claude_request_rejected", False),
        (401, "claude_request_rejected", False),
    ],
)
async def test_anthropic_status_errors(status: int, code: str, retryable: bool) -> None:
    def handler(incoming: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            status, json={"type": "error", "error": {"type": "error", "message": "private"}}
        )

    with pytest.raises(ProviderError, match=code) as raised:
        await AnthropicProvider(client=client(handler)).complete_json(request())
    assert raised.value.retryable is retryable
    assert "private" not in str(raised.value)


@pytest.mark.parametrize(
    ("body", "code"),
    [
        (message(stop_reason="refusal"), "claude_refused"),
        (message(stop_reason="max_tokens"), "claude_incomplete_response"),
        (message(text=""), "claude_incomplete_response"),
    ],
)
async def test_anthropic_incomplete_answers(body: dict[str, Any], code: str) -> None:
    def handler(incoming: httpx2.Request) -> httpx2.Response:
        return streamed(body)

    with pytest.raises(ProviderError, match=code):
        await AnthropicProvider(client=client(handler)).complete_json(request())


def test_registry_picks_claude_transport(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CANDOR_LLM_PROVIDER", raising=False)
    monkeypatch.delenv("CANDOR_CLAUDE_MODEL", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    local = build_provider()
    assert isinstance(local, ClaudeCodeProvider)
    assert local.model == "claude-haiku-5-5"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "synthetic-credential")
    hosted = build_provider("claude:claude-sonnet-5-5")
    assert isinstance(hosted, AnthropicProvider)
    assert hosted.model == "claude-sonnet-5-5"


def result(**overrides: Any) -> bytes:
    event = {
        "type": "result",
        "subtype": "success",
        "is_error": False,
        "structured_output": {"ok": True},
        "total_cost_usd": 0.0004,
        "usage": {
            "input_tokens": 3,
            "cache_creation_input_tokens": 900,
            "cache_read_input_tokens": 100,
            "output_tokens": 40,
        },
    }
    return json.dumps(event | overrides).encode()


def test_claude_code_result_and_usage() -> None:
    text, usage = parse_result(result())
    assert json.loads(text) == {"ok": True}
    assert usage.input_tokens == 1003
    assert usage.output_tokens == 40
    assert usage.cost_usd == 0.0004


@pytest.mark.parametrize(
    ("output", "code", "retryable"),
    [
        (b"not json", "claude_invalid_output", True),
        (b"[]", "claude_invalid_output", True),
        (result(is_error=True, api_error_status=429), "claude_turn_failed", True),
        (result(is_error=True, api_error_status=401), "claude_turn_failed", False),
        (result(subtype="error_max_turns"), "claude_turn_failed", True),
        (result(structured_output=None), "claude_incomplete_response", True),
    ],
)
def test_claude_code_rejects_bad_results(output: bytes, code: str, retryable: bool) -> None:
    with pytest.raises(ProviderError, match=code) as raised:
        parse_result(output)
    assert raised.value.retryable is retryable


async def test_claude_code_command_isolation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "candor_pipeline.providers.claude_code.tempfile.gettempdir", lambda: str(tmp_path)
    )
    monkeypatch.setattr(
        "candor_pipeline.providers.claude_code.executable_command", lambda: ["claude.exe"]
    )
    monkeypatch.setenv("CLAUDECODE", "1")
    captured: list[dict[str, Any]] = []

    def process(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        captured.append(kwargs)
        assert command[command.index("--tools") + 1] == ""
        assert command[command.index("--setting-sources") + 1] == ""
        assert command[command.index("--model") + 1] == "claude-haiku-5-5"
        assert json.loads(command[command.index("--json-schema") + 1]) == request().json_schema
        assert "--no-session-persistence" in command
        assert "--strict-mcp-config" in command
        assert "Synthetic test" not in " ".join(command)
        assert b"Synthetic test" in kwargs["input"]
        assert "CLAUDECODE" not in kwargs["env"]
        assert Path(kwargs["cwd"]).parent == tmp_path
        return subprocess.CompletedProcess(command, 0, result(), b"")

    monkeypatch.setattr("candor_pipeline.providers.claude_code.subprocess.run", process)
    response = await ClaudeCodeProvider().complete_json(request())
    assert json.loads(response.text) == {"ok": True}
    assert response.provider == "claude"
    assert len(captured) == 1
    assert list(tmp_path.iterdir()) == []


async def test_claude_code_timeout_sanitized(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "candor_pipeline.providers.claude_code.tempfile.gettempdir", lambda: str(tmp_path)
    )
    monkeypatch.setattr(
        "candor_pipeline.providers.claude_code.executable_command", lambda: ["claude.exe"]
    )

    def process(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        raise subprocess.TimeoutExpired("private-command", 1, output=b"private-evidence")

    monkeypatch.setattr("candor_pipeline.providers.claude_code.subprocess.run", process)
    with pytest.raises(ProviderError, match="claude_timeout") as raised:
        await ClaudeCodeProvider(timeout=1).complete_json(request())
    assert "private" not in str(raised.value)
    assert list(tmp_path.iterdir()) == []
