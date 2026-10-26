from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field


class Usage(BaseModel):
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    cost_usd: float = Field(default=0, ge=0)


class LLMRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stage: str
    system: str = Field(repr=False)
    user: str = Field(repr=False)
    schema_name: str
    json_schema: dict[str, Any]
    temperature: float = 0
    sample_index: int = 0
    max_tokens: int = 8192


class LLMResponse(BaseModel):
    text: str = Field(default="", repr=False)
    data: dict[str, Any] | None = Field(default=None, repr=False)
    usage: Usage = Field(default_factory=Usage)
    latency_ms: int = 0
    provider: str = ""
    model: str = ""


class ProviderError(Exception):
    def __init__(self, code: str, retryable: bool = False) -> None:
        super().__init__(code)
        self.retryable = retryable


class LLMProvider(Protocol):
    async def complete_json(self, request: LLMRequest) -> LLMResponse: ...
