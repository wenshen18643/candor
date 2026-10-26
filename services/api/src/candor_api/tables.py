from sqlalchemy import JSON, Boolean, Column, Float, ForeignKey, Integer, MetaData, String, Table

metadata = MetaData()


def string(name: str, **kwargs: object) -> Column:
    return Column(name, String, nullable=False, **kwargs)


orgs = Table(
    "orgs", metadata, string("id", primary_key=True), string("slug", unique=True), string("name")
)
reviewers = Table(
    "reviewers",
    metadata,
    string("id", primary_key=True),
    Column("org_id", String, ForeignKey("orgs.id"), nullable=False),
    string("display_name"),
    string("role"),
    string("enc_pk"),
    string("sig_pk"),
    string("created_at"),
)
campaigns = Table(
    "campaigns",
    metadata,
    string("id", primary_key=True),
    Column("org_id", String, ForeignKey("orgs.id"), nullable=False),
    string("title"),
    string("description"),
    Column("threshold", Integer, nullable=False),
    string("issuer_key_id", default=""),
    string("issuer_spki", default=""),
    string("analysis_price_usd"),
    string("status", default="active"),
)
reports = Table(
    "reports",
    metadata,
    string("id", primary_key=True),
    Column("campaign_id", String, ForeignKey("campaigns.id"), nullable=False),
    Column("org_id", String, ForeignKey("orgs.id"), nullable=False),
    string("status"),
    string("received_bucket"),
    string("evidence_root"),
    Column("manifest_box", JSON, nullable=False),
    string("analysis_box_ref"),
    string("analysis_sealed_key"),
    string("enclave_key_id"),
    string("inbox_sig_pk"),
    string("inbox_enc_pk"),
    Column("size_bucket", Integer, nullable=False),
)
report_files = Table(
    "report_files",
    metadata,
    Column("report_id", String, ForeignKey("reports.id"), primary_key=True),
    Column("index", Integer, primary_key=True),
    string("blob_ref"),
    Column("size", Integer, nullable=False),
)
key_shares = Table(
    "key_shares",
    metadata,
    Column("report_id", String, ForeignKey("reports.id"), primary_key=True),
    Column("reviewer_id", String, ForeignKey("reviewers.id"), primary_key=True),
    string("sealed_share"),
)
spent_tokens = Table(
    "spent_tokens",
    metadata,
    string("token_hash", primary_key=True),
    string("campaign_id"),
    string("spent_bucket"),
)
jobs = Table(
    "jobs",
    metadata,
    string("id", primary_key=True),
    Column("report_id", String, ForeignKey("reports.id"), nullable=False),
    string("kind"),
    string("status"),
    Column("attempts", Integer, nullable=False, default=0),
    Column("max_attempts", Integer, nullable=False, default=3),
    Column("lease_expires_at", String),
    string("idempotency_key", unique=True),
    string("payment_ref"),
    string("created_at"),
    string("updated_at"),
    Column("last_error", String),
    Column("summary_json", JSON),
    Column("payment_response", JSON, nullable=False),
)
job_events = Table(
    "job_events",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("job_id", String, ForeignKey("jobs.id"), nullable=False),
    Column("seq", Integer, nullable=False),
    string("stage"),
    string("status"),
    string("at"),
    string("detail"),
    Column("progress", Float),
    Column("provider", String),
    Column("model", String),
)
findings = Table(
    "findings",
    metadata,
    Column("report_id", String, ForeignKey("reports.id"), primary_key=True),
    Column("job_id", String, ForeignKey("jobs.id"), primary_key=True),
    Column("box", JSON, nullable=False),
    string("findings_sha256"),
    string("created_at"),
)
findings_keys = Table(
    "findings_keys",
    metadata,
    string("report_id", primary_key=True),
    string("job_id", primary_key=True),
    string("reviewer_id", primary_key=True),
    string("sealed_key"),
)
access_requests = Table(
    "access_requests",
    metadata,
    string("id", primary_key=True),
    Column("report_id", String, ForeignKey("reports.id"), nullable=False),
    Column("requester_id", String, ForeignKey("reviewers.id"), nullable=False),
    string("reason"),
    string("status"),
    string("created_at"),
    string("expires_at"),
)
access_approvals = Table(
    "access_approvals",
    metadata,
    Column("request_id", String, ForeignKey("access_requests.id"), primary_key=True),
    Column("approver_id", String, ForeignKey("reviewers.id"), primary_key=True),
    string("resealed_share"),
    string("signature"),
    string("created_at"),
)
messages = Table(
    "messages",
    metadata,
    string("id", primary_key=True),
    Column("report_id", String, ForeignKey("reports.id"), nullable=False),
    string("direction"),
    Column("sender_reviewer_id", String),
    Column("boxes_json", JSON, nullable=False),
    string("created_at"),
)
challenges = Table(
    "challenges",
    metadata,
    string("challenge", primary_key=True),
    string("subject"),
    string("purpose"),
    string("expires_at"),
    Column("used", Boolean, nullable=False, default=False),
)
outbox = Table(
    "audit_outbox",
    metadata,
    Column("sequence", Integer, primary_key=True, autoincrement=True),
    string("id", unique=True),
    Column("entry", JSON, nullable=False),
    Column("delivered", Boolean, nullable=False, default=False),
)

report_reads = Table(
    "report_reads",
    metadata,
    Column("report_id", String, ForeignKey("reports.id"), primary_key=True),
    Column("reviewer_id", String, ForeignKey("reviewers.id"), primary_key=True),
    string("last_read_at"),
)

message_reads = Table(
    "message_reads",
    metadata,
    Column("message_id", String, ForeignKey("messages.id"), primary_key=True),
    Column("reviewer_id", String, ForeignKey("reviewers.id"), primary_key=True),
)

message_order = Table(
    "message_order",
    metadata,
    Column("sequence", Integer, primary_key=True, autoincrement=True),
    Column("message_id", String, ForeignKey("messages.id"), nullable=False, unique=True),
)
