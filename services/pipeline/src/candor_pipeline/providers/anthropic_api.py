import asyncio
import time
from typing import Any

import anthropic

from candor_pipeline.providers.base import LLMRequest, LLMResponse, ProviderError, Usage

PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-opus-5-5": (4.0, 20.0),
}


def sample_prompt(request: LLMRequest) -> str:
    return f"Independent extraction sample {request.sample_index}.\n{request.user}"


def input_tokens(usage: Any) -> int:
    return (
        (usage.input_tokens or 0)
        + (usage.cache_creation_input_tokens or 0)
        + (usage.cache_read_input_tokens or 0)
    )


class AnthropicProvider:
    def __init__(
        self,
        model: str = "claude-haiku-5-5",
        client: anthropic.AsyncAnthropic | None = None,
        concurrency: int = 8,
        effort: str = "low",
        retries: int = 4,
    ) -> None:
        self.model = model
        self.client = client or anthropic.AsyncAnthropic(max_retries=retries, timeout=300)
        self.effort = effort
        self.semaphore = asyncio.Semaphore(concurrency)

    async def complete_json(self, request: LLMRequest) -> LLMResponse:
        started = time.monotonic()
        async with self.semaphore:
            try:
                async with self.client.messages.stream(
                    model=self.model,
                    max_tokens=max(request.max_tokens, 64000),
                    system=request.system,
                    messages=[{"role": "user", "content": sample_prompt(request)}],
                    output_config={
                        "effort": self.effort,
                        "format": {
                            "type": "json_schema",
                            "schema": anthropic.transform_schema(request.json_schema),
                        },
                    },
                ) as stream:
                    message = await stream.get_final_message()
            except anthropic.APIConnectionError:
                raise ProviderError("claude_transport_failed", True) from None
            except anthropic.APIStatusError as error:
                if error.status_code == 429 or error.status_code >= 500:
                    raise ProviderError("claude_unavailable", True) from None
                raise ProviderError("claude_request_rejected") from None
        if message.stop_reason == "refusal":
            raise ProviderError("claude_refused")
        text = next((block.text for block in message.content if block.type == "text"), "")
        if message.stop_reason == "max_tokens" or not text:
            raise ProviderError("claude_incomplete_response", True)
        tokens_in = input_tokens(message.usage)
        tokens_out = message.usage.output_tokens or 0
        price_in, price_out = PRICES.get(self.model, (0, 0))
        return LLMResponse(
            text=text,
            provider="claude",
            model=self.model,
            latency_ms=int((time.monotonic() - started) * 1000),
            usage=Usage(
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                cost_usd=(tokens_in * price_in + tokens_out * price_out) / 1e6,
            ),
        )
