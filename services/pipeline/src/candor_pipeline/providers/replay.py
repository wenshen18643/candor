import asyncio
import hashlib
import json
from pathlib import Path
from typing import Literal

from candor_pipeline.providers.base import LLMProvider, LLMRequest, LLMResponse, ProviderError


def cassette_key(request: LLMRequest) -> str:
    fields = {
        key: getattr(request, key)
        for key in ("stage", "system", "user", "schema_name", "sample_index")
    }
    return hashlib.sha256(
        json.dumps(fields, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


class ReplayProvider:
    def __init__(
        self,
        directory: str | Path,
        inner: LLMProvider | None = None,
        mode: Literal["replay", "record", "auto"] = "replay",
        synthetic: bool = False,
    ) -> None:
        if mode != "replay" and not synthetic:
            raise ProviderError("recording_requires_synthetic_data")
        self.directory = Path(directory)
        self.inner = inner
        self.mode = mode
        self.lock = asyncio.Lock()

    async def complete_json(self, request: LLMRequest) -> LLMResponse:
        path = self.directory / (cassette_key(request) + ".json")
        if self.mode != "record" and path.is_file():
            return LLMResponse.model_validate_json(await asyncio.to_thread(path.read_bytes))
        if self.mode == "replay" or self.inner is None:
            raise ProviderError("cassette_missing")
        response = await self.inner.complete_json(request)
        async with self.lock:
            await asyncio.to_thread(self._write, path, response)
        return response

    def _write(self, path: Path, response: LLMResponse) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".pending")
        temporary.write_text(response.model_dump_json(), encoding="utf-8")
        temporary.replace(path)
