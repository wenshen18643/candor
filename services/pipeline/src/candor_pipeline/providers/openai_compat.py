import asyncio
import random
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from candor_pipeline.providers.base import LLMRequest, LLMResponse, ProviderError, Usage

PRICES: dict[str, tuple[float, float]] = {
    "muse-spark-1.3": (1.25, 4.25),
    "muse-spark-1.2": (1.25, 4.25),
    "muse-spark-1.1": (1.25, 4.25),
    "muse-wonder-1.0": (4.0, 20.0),
    "accounts/fireworks/models/muse-spark-open": (1.25, 4.25),
    "meta-models/muse-spark-open": (1.25, 4.25),
}


def retry_delay(value: str | None, attempt: int) -> float:
    delay = min(16, 0.5 * 2**attempt) + random.random() * 0.25
    if value:
        try:
            return max(delay, float(value))
        except ValueError:
            try:
                return max(
                    delay, (parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds()
                )
            except (ValueError, TypeError):
                pass
    return delay


class OpenAICompatProvider:
    def __init__(
        self,
        provider: str,
        model: str,
        base_url: str,
        api_key: str,
        client: httpx.AsyncClient | None = None,
        retries: int = 4,
        prices: dict[str, tuple[float, float]] | None = None,
    ) -> None:
        if not api_key or not model or model.endswith("-contributor"):
            raise ProviderError("invalid_provider_configuration")
        self.provider = provider
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.client = client
        self.retries = retries
        self.prices = PRICES | (prices or {})

    def _body(self, request: LLMRequest) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.user},
            ],
            "temperature": request.temperature,
            "max_completion_tokens": request.max_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": request.schema_name,
                    "schema": request.json_schema,
                    "strict": True,
                },
            },
        }
        if self.provider == "meta":
            body["reasoning_effort"] = "low"
        return body

    async def complete_json(self, request: LLMRequest) -> LLMResponse:
        if self.client is not None:
            return await self._request(self.client, request)
        async with httpx.AsyncClient(timeout=90) as client:
            return await self._request(client, request)

    async def _request(self, client: httpx.AsyncClient, request: LLMRequest) -> LLMResponse:
        started = time.monotonic()
        for attempt in range(self.retries + 1):
            try:
                response = await client.post(
                    self.base_url + "/chat/completions",
                    headers={"Authorization": "Bearer " + self.api_key},
                    json=self._body(request),
                )
            except httpx.TransportError:
                if attempt == self.retries:
                    raise ProviderError("provider_transport_failed", True) from None
                await asyncio.sleep(retry_delay(None, attempt))
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == self.retries:
                    raise ProviderError("provider_unavailable", True)
                await asyncio.sleep(retry_delay(response.headers.get("Retry-After"), attempt))
                continue
            if response.is_error:
                raise ProviderError("provider_request_rejected")
            try:
                data = response.json()
                choice = data["choices"][0]
                content = choice["message"].get("content")
                if choice.get("finish_reason") != "stop" or not isinstance(content, str):
                    raise ProviderError("provider_incomplete_response", True)
                usage = data.get("usage") or {}
                tokens_in = usage.get("prompt_tokens", 0)
                tokens_out = usage.get("completion_tokens", 0)
                price_in, price_out = self.prices.get(self.model, (0, 0))
                return LLMResponse(
                    text=content,
                    provider=self.provider,
                    model=self.model,
                    latency_ms=int((time.monotonic() - started) * 1000),
                    usage=Usage(
                        input_tokens=tokens_in,
                        output_tokens=tokens_out,
                        cost_usd=(tokens_in * price_in + tokens_out * price_out) / 1e6,
                    ),
                )
            except (KeyError, IndexError, ValueError, TypeError):
                raise ProviderError("provider_invalid_response") from None
        raise ProviderError("provider_unavailable", True)
