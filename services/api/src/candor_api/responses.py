from typing import Any, Literal

from candor_pipeline.contracts import StageEvent
from pydantic import BaseModel, Field, SerializerFunctionWrapHandler, model_serializer

from candor_api.schemas import (
    AnalysisEnvelope,
    CandorBox,
    HexHash,
    PublicKey,
    ReportStatus,
    SealBox,
    Summary,
)


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class Org(BaseModel):
    slug: str
    name: str


class IssuerPublic(BaseModel):
    key_id: str
    spki: str


class EnclavePublic(BaseModel):
    key_id: str
    enc_pk: PublicKey


class ReviewerPublic(BaseModel):
    reviewer_id: str
    display_name: str
    enc_pk: PublicKey


class CampaignDescriptor(BaseModel):
    campaign_id: str
    org: Org
    title: str
    description: str
    threshold: int
    analysis_price_usd: str
    identity_url: str
    issuer: IssuerPublic
    enclave: EnclavePublic
    reviewers: list[ReviewerPublic]


class SignedTreeHead(BaseModel):
    tree_size: int
    root_hash: HexHash
    timestamp: str
    key_id: str
    signature: str


class Receipt(BaseModel):
    evidence_root: HexHash
    log_index: int
    sth: SignedTreeHead


class Submitted(BaseModel):
    report_id: str
    receipt: Receipt


class Challenge(BaseModel):
    challenge: str
    expires_at: str


class ReviewerSession(BaseModel):
    token: str
    expires_at: str


class InboxSession(ReviewerSession):
    report_ids: list[str]


class JobSnapshot(BaseModel):
    status: str
    job_id: str
    updated_at: str
    stage: str | None = None


class ReportSummary(BaseModel):
    report_id: str
    campaign_id: str
    status: ReportStatus
    received_bucket: str
    file_count: int
    size_bucket: int
    analysis: JobSnapshot | None
    unread_replies: int
    pending_access: int


class InboxPublic(BaseModel):
    sig_pk: PublicKey
    enc_pk: PublicKey


class ReportMetadata(ReportSummary):
    evidence_root: HexHash
    inbox: InboxPublic


class FileMetadata(BaseModel):
    index: int
    size: int


class Findings(BaseModel):
    job_id: str
    box: CandorBox
    sealed_key: str
    findings_sha256: HexHash


class AccessRequest(BaseModel):
    id: str
    report_id: str
    requester_id: str
    reason: str
    status: Literal["pending", "granted", "denied", "expired"]
    created_at: str
    expires_at: str


class OmitNulls(BaseModel):
    @model_serializer(mode="wrap")
    def serialize(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        return {key: value for key, value in handler(self).items() if value is not None}


class MessageRecipient(OmitNulls):
    reviewer_id: str
    box: SealBox | None = None


class Message(OmitNulls):
    id: str
    direction: Literal["to_reporter", "to_reviewers"]
    created_at: str
    box: SealBox | None = None
    boxes: list[MessageRecipient] | None = None


class ReportDetail(BaseModel):
    report: ReportMetadata
    manifest_box: CandorBox
    files: list[FileMetadata]
    my_sealed_share: str
    findings: Findings | None
    messages: list[Message]
    access_requests: list[AccessRequest]


class FileResponse(BaseModel):
    index: int
    box: CandorBox


class PaymentSummary(BaseModel):
    scheme: str
    network: str
    amount_atomic: str
    status: str


class JobAccepted(BaseModel):
    job_id: str
    status: str
    payment: PaymentSummary


class WorkerReviewer(BaseModel):
    reviewer_id: str
    enc_pk: PublicKey


class ClaimedJob(BaseModel):
    job_id: str
    report_id: str
    attempt: int
    analysis: AnalysisEnvelope
    reviewers: list[WorkerReviewer]


class PaymentRequirements(BaseModel):
    scheme: Literal["exact"]
    network: Literal["base-sepolia"]
    asset: str
    max_amount_required: str = Field(alias="maxAmountRequired")
    pay_to: str = Field(alias="payTo")
    resource: str
    description: str
    mime_type: str = Field(alias="mimeType")
    max_timeout_seconds: int = Field(alias="maxTimeoutSeconds")
    extra: dict[str, str]


class PaymentRequired(BaseModel):
    x402_version: Literal[1] = Field(alias="x402Version")
    error: str
    accepts: list[PaymentRequirements]


class StoredEvent(StageEvent):
    id: int
    seq: int


class JobDetail(BaseModel):
    job_id: str
    report_id: str
    kind: Literal["analysis"]
    status: str
    attempts: int
    max_attempts: int
    lease_expires_at: str | None
    created_at: str
    updated_at: str
    last_error: str | None
    summary_json: Summary | None
    events: list[StoredEvent]


class AccessApproval(BaseModel):
    request_id: str
    approver_id: str
    resealed_share: str
    signature: str
    created_at: str


class AccessDetail(AccessRequest):
    sealed_share: str
    resealed_shares: list[AccessApproval]


class ApprovalMetadata(BaseModel):
    approver_id: str
    created_at: str


class ListedAccess(AccessRequest):
    requester_enc_pk: PublicKey
    approvals: list[ApprovalMetadata]


class InboxReport(BaseModel):
    report_id: str
    status: ReportStatus
    messages: list[Message]


class InboxMessages(BaseModel):
    reports: list[InboxReport]


class LogEntry(BaseModel):
    index: int
    entry_type: str
    entry: dict[str, Any]
    leaf_b64u: str
    created_at: str


class Anchor(BaseModel):
    tree_size: int
    root_hash: HexHash
    chain: str
    tx_ref: str
    created_at: str
