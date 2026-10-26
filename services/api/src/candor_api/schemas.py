import math
from typing import Annotated, Literal
from uuid import UUID

from candor_pipeline.contracts import AnalysisMetrics, StageName, StageStatus
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from candor_api.common import unb64


def binary(value: str, minimum: int = 1, exact: int | None = None) -> str:
    size = len(unb64(value))
    if size < minimum or (exact is not None and size != exact):
        raise ValueError("Invalid binary length")
    return value


def uuid4_string(value: str) -> str:
    parsed = UUID(value)
    if parsed.version != 4 or str(parsed) != value:
        raise ValueError("Expected canonical UUIDv4")
    return value


Binary = Annotated[str, AfterValidator(binary)]
PublicKey = Annotated[str, AfterValidator(lambda value: binary(value, exact=32))]
Signature = Annotated[str, AfterValidator(lambda value: binary(value, exact=64))]
SealedKey = Annotated[str, AfterValidator(lambda value: binary(value, exact=80))]
SealedShare = Annotated[str, AfterValidator(lambda value: binary(value, minimum=81))]
HexHash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Identifier = Annotated[str, AfterValidator(uuid4_string)]
SafeName = Annotated[str, Field(max_length=100, pattern=r"^[A-Za-z0-9_.:/-]*$")]
ReportStatus = Literal["received", "triage", "investigating", "closed"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class CandorBox(Strict):
    v: Literal[1]
    alg: Literal["xc20p-padme"]
    n: Annotated[str, AfterValidator(lambda value: binary(value, exact=24))]
    c: Annotated[str, AfterValidator(lambda value: binary(value, minimum=20))]


class SealBox(Strict):
    v: Literal[1]
    alg: Literal["seal-padme"]
    c: Annotated[str, AfterValidator(lambda value: binary(value, minimum=52))]


class BlindToken(Strict):
    key_id: str = Field(pattern=r"^[0-9a-f]{16}$")
    prepared: Annotated[str, AfterValidator(lambda value: binary(value, exact=64))]
    signature: Annotated[str, AfterValidator(lambda value: binary(value, exact=256))]


class FileBox(Strict):
    index: int = Field(ge=0)
    box: CandorBox


class Share(Strict):
    reviewer_id: Identifier
    sealed_share: SealedShare


class Shares(Strict):
    scheme: Literal["shamir-gf256"]
    threshold: int = Field(ge=1, le=255)
    shares: list[Share] = Field(min_length=1, max_length=255)


class AnalysisEnvelope(Strict):
    enclave_key_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    sealed_key: SealedKey
    box: CandorBox


class InboxKeys(Strict):
    sig_pk: PublicKey
    enc_pk: PublicKey


class Submission(Strict):
    report_id: Identifier
    campaign_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")
    token: BlindToken
    evidence_root: HexHash
    manifest: CandorBox
    files: list[FileBox] = Field(max_length=256)
    key_shares: Shares
    analysis: AnalysisEnvelope
    inbox: InboxKeys

    @model_validator(mode="after")
    def ordered_files(self) -> "Submission":
        if [file.index for file in self.files] != list(range(len(self.files))):
            raise ValueError("Files must have contiguous ordered indices")
        return self


class ReviewerChallenge(Strict):
    reviewer_id: Identifier


class ReviewerLogin(ReviewerChallenge):
    challenge: PublicKey
    signature: Signature


class InboxChallenge(Strict):
    sig_pk: PublicKey


class InboxLogin(InboxChallenge):
    challenge: PublicKey
    signature: Signature


class StatusChange(Strict):
    status: ReportStatus


class AccessRequest(Strict):
    reason: str = Field(min_length=1, max_length=1000)


class Approval(Strict):
    resealed_share: SealedShare
    signature: Signature


class ReviewerMessage(Strict):
    box: SealBox
    question_ids: list[str] = Field(default_factory=list, max_length=100)


class RecipientBox(Strict):
    reviewer_id: Identifier
    box: SealBox


class InboxMessage(Strict):
    report_id: Identifier
    boxes: list[RecipientBox] = Field(min_length=1, max_length=255)
    answers_count: int = Field(ge=0, le=100)


class FindingsKey(Strict):
    reviewer_id: Identifier
    sealed_key: SealedKey


class FindingsEnvelope(Strict):
    box: CandorBox
    sealed_keys: list[FindingsKey] = Field(min_length=1, max_length=255)
    findings_sha256: HexHash


class StageSummary(Strict):
    stage: StageName
    status: StageStatus
    duration_ms: int = Field(ge=0)
    llm_calls: int = Field(ge=0)
    cost_usd: float = Field(ge=0, allow_inf_nan=False)
    provider: SafeName = ""
    model: SafeName = ""


class Summary(Strict):
    stages: list[StageSummary] = Field(max_length=12)
    metrics: AnalysisMetrics

    @model_validator(mode="after")
    def numeric_metrics(self) -> "Summary":
        if any(
            not math.isfinite(value) or value < 0 for value in self.metrics.model_dump().values()
        ):
            raise ValueError("Metrics must be finite and nonnegative")
        return self


class Completion(Strict):
    findings: FindingsEnvelope
    summary: Summary


class Failure(Strict):
    error: str = Field(max_length=2000)
    retryable: bool
