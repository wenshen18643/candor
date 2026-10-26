import json
from pathlib import Path

from pydantic import TypeAdapter

from candor_pipeline.providers.base import LLMProvider
from candor_pipeline.providers.registry import build_provider


class Router:
    def __init__(
        self, default: LLMProvider | None = None, routes: dict[str, str] | None = None
    ) -> None:
        self.routes = routes or {}
        self.default = default
        self.providers: dict[str, LLMProvider] = {}

    @classmethod
    def from_file(cls, path: Path, default: LLMProvider | None = None) -> "Router":
        routes = TypeAdapter(dict[str, str]).validate_python(json.loads(path.read_text("utf-8")))
        return cls(default, routes)

    def for_stage(self, stage: str) -> LLMProvider:
        spec = self.routes.get(stage, self.routes.get("default"))
        if spec is None and self.default is not None:
            return self.default
        key = spec or "default"
        if key not in self.providers:
            self.providers[key] = build_provider(spec)
        return self.providers[key]
