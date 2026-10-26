import os

from candor_pipeline.providers.anthropic_api import AnthropicProvider
from candor_pipeline.providers.base import LLMProvider, ProviderError
from candor_pipeline.providers.claude_code import ClaudeCodeProvider
from candor_pipeline.providers.codex_cli import CodexCLIProvider
from candor_pipeline.providers.openai_compat import OpenAICompatProvider
from candor_pipeline.providers.replay import ReplayProvider


def build_provider(spec: str | None = None) -> LLMProvider:
    provider, _, model = (spec or os.getenv("CANDOR_LLM_PROVIDER", "claude")).partition(":")
    if provider == "claude":
        model = model or os.getenv("CANDOR_CLAUDE_MODEL", "claude-haiku-5-5")
        if os.getenv("ANTHROPIC_API_KEY", "").strip():
            return AnthropicProvider(model)
        return ClaudeCodeProvider(model)
    if provider == "codex":
        return CodexCLIProvider(model or os.getenv("CANDOR_CODEX_MODEL", "gpt-6.1-sol"))
    if provider == "replay":
        return ReplayProvider(os.environ["CANDOR_REPLAY_DIR"])
    endpoints = {
        "meta": ("https://api.meta.ai/v1", "MODEL_API_KEY", "CANDOR_META_MODEL", "muse-spark-1.3"),
        "fireworks": (
            "https://api.fireworks.ai/inference/v1",
            "FIREWORKS_API_KEY",
            "CANDOR_FIREWORKS_MODEL",
            "",
        ),
        "baseten": (
            os.getenv("CANDOR_BASETEN_BASE_URL") or "https://inference.baseten.co/v1",
            "BASETEN_API_KEY",
            "CANDOR_BASETEN_MODEL",
            "",
        ),
    }
    if provider not in endpoints:
        raise ProviderError("unknown_provider")
    base, key, model_env, default = endpoints[provider]
    return OpenAICompatProvider(
        provider, model or os.getenv(model_env, default), base, os.getenv(key, "")
    )
