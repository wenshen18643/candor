import asyncio
from pathlib import Path

from candor_pipeline.providers.base import LLMProvider, LLMRequest, LLMResponse, ProviderError


class TapProvider:
    def __init__(
        self, inner: LLMProvider, path: Path | None = None, synthetic: bool = False
    ) -> None:
        if path is not None and not synthetic:
            raise ProviderError("recording_requires_synthetic_data")
        self.inner = inner
        self.path = path
        self.requests: list[LLMRequest] = []
        self.lock = asyncio.Lock()

    async def complete_json(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request.model_copy(deep=True))
        if self.path is not None:
            async with self.lock:
                await asyncio.to_thread(self._write, request)
        return await self.inner.complete_json(request)

    def _write(self, request: LLMRequest) -> None:
        if self.path is not None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as stream:
                stream.write(request.model_dump_json() + "\n")
