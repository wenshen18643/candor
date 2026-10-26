from pydantic import BaseModel, ConfigDict, Field


class PipelineConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    samples: int = Field(default=3, ge=1, le=12)
    temperatures: tuple[float, float] = (0.2, 0.8)
    batch_size: int = Field(default=20, ge=1)
    cluster_threshold: float = Field(default=0.72, ge=0, le=1)
    quarantine_threshold: float = Field(default=0.7, ge=0, le=1)
    concurrency: int = Field(default=4, ge=1)
    repairs: int = Field(default=2, ge=0, le=5)
    retries: int = Field(default=2, ge=0, le=4)
    max_tokens: int = Field(default=8192, ge=128)
    router: dict[str, str] = Field(default_factory=dict)
