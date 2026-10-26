import copy
import hashlib
import json
import random
import re
from typing import Literal

from candor_pipeline.providers.base import LLMProvider, LLMRequest, LLMResponse
from candor_pipeline.providers.replay import cassette_key

Fault = Literal["truncated", "missing", "types", "citations", "prose", "empty"]


class ChaosProvider:
    def __init__(
        self, inner: LLMProvider, p: float = 0.3, seed: int = 0, fault: Fault | None = None
    ) -> None:
        if not 0 <= p <= 1:
            raise ValueError("invalid_probability")
        self.inner = inner
        self.p = p
        self.seed = seed
        self.fault = fault

    async def complete_json(self, request: LLMRequest) -> LLMResponse:
        response = await self.inner.complete_json(request)
        rng = random.Random(
            hashlib.sha256(f"{self.seed}:{cassette_key(request)}".encode()).digest()
        )
        if rng.random() >= self.p:
            return response
        data = (
            copy.deepcopy(response.data) if response.data is not None else json.loads(response.text)
        )
        fault = self.fault or rng.choice(
            ["truncated", "missing", "types", "citations", "prose", "empty"]
        )
        if fault == "missing" and data:
            data.pop(next(iter(data)))
        if fault == "types" and data:
            data[next(iter(data))] = {"invalid": True}
        text = json.dumps(data)
        if fault == "citations":
            text = re.sub(r"(?:D\d+|S)\.P\d+", "D999.P999", text)
        if fault == "truncated":
            text = text[: len(text) // 2]
        if fault == "prose":
            text = "Result follows:\n" + text + "\nEnd."
        if fault == "empty":
            text = ""
        return response.model_copy(update={"data": None, "text": text})
