import json
import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
import respx

from candor_pipeline.providers.base import ProviderError
from candor_pipeline.providers.codex_cli import CodexCLIProvider, parse_events
from candor_pipeline.providers.openai_compat import OpenAICompatProvider, retry_delay
from candor_pipeline.providers.registry import build_provider
from candor_pipeline.providers.replay import ReplayProvider, cassette_key
from candor_pipeline.providers.tap import TapProvider
from candor_pipeline.router import Router
from tests.test_structured import SequenceProvider, request


@pytest.mark.parametrize(
    ("name", "url"),
    [
        ("meta", "https://api.meta.ai/v1"),
        ("fireworks", "https://api.fireworks.ai/inference/v1"),
        ("baseten", "https://inference.baseten.co/v1"),
    ],
)
@respx.mock
async def test_openai_wire_contract(name: str, url: str) -> None:
    route = respx.post(url + "/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"ok":true}'}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 50},
            },
        )
    )
    provider = OpenAICompatProvider(name, "muse-spark-1.3", url, "synthetic-credential")
    response = await provider.complete_json(request())
    assert response.text == '{"ok":true}'
    assert response.usage.cost_usd == pytest.approx(0.0003375)
    sent = route.calls[0].request
    assert sent.headers["Authorization"] == "Bearer synthetic-credential"
    body = json.loads(sent.content)
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["response_format"]["json_schema"]["schema"] == request().json_schema
    assert body["max_completion_tokens"] == request().max_tokens
    assert body["messages"][0]["role"] == "system"
    assert body["messages"][0]["content"] == request().system


@respx.mock
async def test_schema_in_prompt_when_provider_does_not_enforce_it() -> None:
    url = "https://inference.baseten.co/v1"
    route = respx.post(url + "/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]}
        )
    )
    provider = OpenAICompatProvider("baseten", "meta-models/muse-spark-open", url, "synthetic")
    await provider.complete_json(request())
    system = json.loads(route.calls[0].request.content)["messages"][0]["content"]
    assert system.startswith(request().system)
    assert json.dumps(request().json_schema, separators=(",", ":")) in system


@respx.mock
async def test_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeper = AsyncMock()
    monkeypatch.setattr("candor_pipeline.providers.openai_compat.asyncio.sleep", sleeper)
    route = respx.post("https://api.meta.ai/v1/chat/completions").mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "3"}),
            httpx.Response(503),
            httpx.Response(
                200, json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]}
            ),
        ]
    )
    result = await OpenAICompatProvider(
        "meta", "muse-spark-1.3", "https://api.meta.ai/v1", "test"
    ).complete_json(request())
    assert route.call_count == 3
    assert sleeper.await_args_list[0].args[0] >= 3
    assert result.usage.input_tokens == 0


@pytest.mark.parametrize(
    ("status", "retryable"), [(401, False), (400, False), (429, True), (500, True)]
)
@respx.mock
async def test_provider_errors_sanitized(status: int, retryable: bool) -> None:
    route = respx.post("https://api.meta.ai/v1/chat/completions").mock(
        return_value=httpx.Response(status, json={"error": "plaintext-sensitive-value"})
    )
    with pytest.raises(ProviderError) as error:
        await OpenAICompatProvider(
            "meta", "muse-spark-1.3", "https://api.meta.ai/v1", "test", retries=0
        ).complete_json(request())
    assert error.value.retryable is retryable
    assert "plaintext" not in str(error.value)
    assert route.call_count == 1


@respx.mock
async def test_incomplete_output_rejected() -> None:
    respx.post("https://api.meta.ai/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "{}"}, "finish_reason": "length"}]}
        )
    )
    with pytest.raises(ProviderError, match="incomplete"):
        await OpenAICompatProvider(
            "meta", "muse-spark-1.3", "https://api.meta.ai/v1", "test"
        ).complete_json(request())


def test_retry_http_date_and_invalid_header() -> None:
    assert retry_delay("Mon, 26 Oct 2099 00:00:00 GMT", 0) > 1
    assert retry_delay("invalid", 0) >= 0.5


async def test_replay_roundtrip_and_miss(tmp_path: Path) -> None:
    inner = SequenceProvider(['{"ok":true}'])
    recorder = ReplayProvider(tmp_path, inner, "record", synthetic=True)
    recorded = await recorder.complete_json(request())
    replayed = await ReplayProvider(tmp_path).complete_json(request())
    assert replayed == recorded
    assert len(list(tmp_path.glob("*.json"))) == 1
    with pytest.raises(ProviderError, match="cassette_missing"):
        await ReplayProvider(tmp_path).complete_json(
            request().model_copy(update={"sample_index": 1})
        )


def test_replay_key_fields_and_privacy(tmp_path: Path) -> None:
    original = request()
    assert cassette_key(original) == cassette_key(original.model_copy(update={"temperature": 0.8}))
    assert cassette_key(original) != cassette_key(original.model_copy(update={"user": "different"}))
    with pytest.raises(ProviderError, match="synthetic"):
        ReplayProvider(tmp_path, mode="record")
    with pytest.raises(ProviderError, match="synthetic"):
        TapProvider(SequenceProvider([]), tmp_path / "requests.jsonl")


async def test_tap_in_memory_and_synthetic_file(tmp_path: Path) -> None:
    path = tmp_path / "tap.jsonl"
    tap = TapProvider(SequenceProvider(['{"ok":true}']), path, synthetic=True)
    await tap.complete_json(request())
    assert tap.requests == [request()]
    assert json.loads(path.read_text())["user"] == request().user


def test_registry_and_router(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CANDOR_LLM_PROVIDER", "replay")
    monkeypatch.setenv("CANDOR_REPLAY_DIR", str(tmp_path))
    assert isinstance(build_provider(), ReplayProvider)
    with pytest.raises(ProviderError, match="unknown_provider"):
        build_provider("not-real")
    with pytest.raises(ProviderError):
        OpenAICompatProvider("meta", "muse-spark-1.3-contributor", "https://api.meta.ai/v1", "test")
    default = SequenceProvider([])
    route = Router(default, {"extract": "codex:gpt-6.1-sol"})
    assert route.for_stage("verify") is default
    assert isinstance(route.for_stage("extract"), CodexCLIProvider)
    assert route.for_stage("extract") is route.for_stage("extract")


def test_default_provider_prefers_a_muse_host_with_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ("CANDOR_LLM_PROVIDER", "MODEL_API_KEY", "FIREWORKS_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("BASETEN_API_KEY", "synthetic-credential")
    monkeypatch.delenv("CANDOR_BASETEN_MODEL", raising=False)
    provider = build_provider()
    assert isinstance(provider, OpenAICompatProvider)
    assert (provider.provider, provider.model) == ("baseten", "meta-models/muse-spark-open-1026")
    monkeypatch.setenv("CANDOR_LLM_PROVIDER", "")
    assert build_provider().provider == "baseten"


def test_codex_events_and_usage() -> None:
    events = [
        {"type": "thread.started"},
        {"type": "item.completed", "item": {"type": "error", "message": "hook notice"}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": '{"ok":true}'}},
        {"type": "turn.completed", "usage": {"input_tokens": 12, "output_tokens": 4}},
    ]
    text, usage = parse_events("\n".join(json.dumps(event) for event in events).encode())
    assert text == '{"ok":true}'
    assert usage.input_tokens == 12


@pytest.mark.parametrize(
    "event",
    [
        {"type": "turn.failed"},
        {"type": "error"},
        {"type": "item.started", "item": {"type": "command_execution"}},
        {"type": "turn.started"},
    ],
)
def test_codex_rejects_failed_and_tool_events(event: dict[str, Any]) -> None:
    with pytest.raises(ProviderError):
        parse_events(json.dumps(event).encode())


async def test_codex_command_stdin_and_cleanup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        "candor_pipeline.providers.codex_cli.tempfile.gettempdir", lambda: str(tmp_path)
    )
    monkeypatch.setattr(
        "candor_pipeline.providers.codex_cli.executable_command", lambda: ["codex.exe"]
    )
    captured: list[list[str]] = []

    def process(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        captured.append(command)
        assert "--ephemeral" in command
        assert "--ignore-user-config" in command
        assert "--json" in command
        assert "shell_tool" in command
        assert command[-1] == "-"
        assert "Synthetic test" not in " ".join(command)
        assert b"Synthetic test" in kwargs["input"]
        schema_path = Path(command[command.index("--output-schema") + 1])
        assert json.loads(schema_path.read_text()) == request().json_schema
        stdout = (
            b'{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}\n'
            b'{"type":"turn.completed"}'
        )
        return subprocess.CompletedProcess(command, 0, stdout, b"")

    monkeypatch.setattr("candor_pipeline.providers.codex_cli.subprocess.run", process)
    response = await CodexCLIProvider().complete_json(request())
    assert response.text == "{}"
    assert len(captured) == 1
    assert list(tmp_path.iterdir()) == []


async def test_codex_timeout_sanitized(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        "candor_pipeline.providers.codex_cli.tempfile.gettempdir", lambda: str(tmp_path)
    )
    monkeypatch.setattr(
        "candor_pipeline.providers.codex_cli.executable_command", lambda: ["codex.exe"]
    )

    def process(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        raise subprocess.TimeoutExpired("private-command", 1, output=b"private-evidence")

    monkeypatch.setattr("candor_pipeline.providers.codex_cli.subprocess.run", process)
    with pytest.raises(ProviderError, match="codex_timeout"):
        await CodexCLIProvider(timeout=1).complete_json(request())
    assert list(tmp_path.iterdir()) == []
