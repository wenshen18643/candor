# 02 · Report API (`services/api`)

FastAPI service, uv project `candor-api`, package `src/candor_api`. Python 3.12+. SQLAlchemy 2.x
(sync engine is fine) with SQLite by default and Postgres via URL. Three physically separate
databases: `reports.db` (`CANDOR_REPORTS_DB_URL`), `audit.db` (`CANDOR_AUDIT_DB_URL`), `payments.db`
(`CANDOR_PAYMENTS_DB_URL`), defaulting to files in `CANDOR_DATA_DIR`. Ciphertext blobs are stored in
a `BlobStore` interface (local filesystem default under `CANDOR_DATA_DIR/blobs`, content-addressed by
sha256 of ciphertext). Dependencies: `fastapi`, `uvicorn[standard]`, `sqlalchemy`, `pydantic>=2`,
`pydantic-settings`, `pynacl`, `cryptography`, `pyjwt`, `httpx`, `sse-starlette`, `typer`, `orjson`,
plus `candor-pipeline` as an editable path dependency only for its `contracts` models (the API never
runs the pipeline). Dev: `pytest`, `httpx`, `respx`.

The API never sees plaintext evidence, plaintext findings, the pseudonym map, or any key able to
decrypt them. All protocol details are in 01-protocols.

## Domain model (reports.db)

- `orgs(id, slug, name)`
- `reviewers(id, org_id, display_name, role ['reviewer' | 'admin' | 'auditor'], enc_pk, sig_pk, created_at)`
- `campaigns(id (slug), org_id, title, description, threshold, issuer_key_id, issuer_spki,
  analysis_price_usd, status)`. Issuer key material is fetched from the identity service
  (`GET {CANDOR_IDENTITY_URL}/v1/campaigns/{id}/issuer`) and cached; the API only ever has the
  public key.
- `reports(id, campaign_id, org_id, status ['received' | 'triage' | 'investigating' | 'closed'],
  received_bucket (hour), evidence_root, manifest_box, analysis_box_ref, analysis_sealed_key,
  enclave_key_id, inbox_sig_pk, inbox_enc_pk, size_bucket)`
- `report_files(report_id, index, blob_ref, size)`
- `key_shares(report_id, reviewer_id, sealed_share)`
- `spent_tokens(token_hash PRIMARY KEY, campaign_id, spent_bucket)`
- `jobs(id, report_id, kind 'analysis', status ['queued' | 'leased' | 'running' | 'succeeded' |
  'failed' | 'dead'], attempts, max_attempts 3, lease_expires_at, idempotency_key UNIQUE,
  payment_ref, created_at, updated_at, last_error, summary_json)`
- `job_events(id, job_id, seq, stage, status, at, detail, progress, provider, model)`
- `findings(report_id, job_id, box, findings_sha256, created_at)` and
  `findings_keys(report_id, job_id, reviewer_id, sealed_key)`
- `access_requests(id, report_id, requester_id, reason, status ['pending' | 'granted' | 'denied' |
  'expired'], created_at, expires_at)` and `access_approvals(request_id, approver_id,
  resealed_share, signature, created_at)`
- `messages(id, report_id, direction ['to_reporter' | 'to_reviewers'], sender_reviewer_id, boxes_json,
  created_at)`; `boxes_json` is one SealBox for `to_reporter` or `[{reviewer_id, box}]` for replies.
- `challenges(challenge, subject, purpose, expires_at, used)`

## Transparency log (audit.db)

`log_entries(index PRIMARY KEY, leaf_bytes BLOB, entry_type, created_at)`, `tree_heads(tree_size,
root_hash, timestamp, signature)`, `anchors(tree_size, root_hash, chain, tx_ref, created_at)`.
Implement RFC 9162 MTH, inclusion and consistency proofs with an in-memory cache of level hashes
rebuilt on startup. Sign a new STH after every append (cheap) and expose the latest. Anchoring:
`AnchorAdapter` with `mock` (records a fake tx ref deterministically from the root) and `evm`
(web3-free raw JSON-RPC: send a 0-value self-transaction with the root hash as calldata on Base
Sepolia using `ANCHOR_RPC_URL` and `ANCHOR_PRIVATE_KEY`; use `eth-account` for signing). Anchor every
`CANDOR_ANCHOR_EVERY` entries (default 16) and on demand via admin endpoint.

Entry types and fields (only these fields; never payload contents): `report.submitted {report_id,
campaign_id, evidence_root, bucket}`, `report.status_changed {report_id, status, actor}`,
`analysis.requested {report_id, job_id, payment_ref}`, `analysis.completed {report_id, job_id,
findings_sha256}`, `findings.opened {report_id, reviewer_id}`, `access.requested {request_id,
report_id, requester_id}`, `access.approved {request_id, approver_id}`, `access.granted
{request_id}`, `evidence.fetched {report_id, reviewer_id, file_index}`, `message.sent {report_id,
direction}`, `anchor.published {tree_size, root_hash, chain, tx_ref}`.

## Payments (payments.db, x402)

`payments(id, scheme, network, asset, amount_atomic, payer, status, tx_ref, facilitator, created_at,
job_link)` where `job_link = hex(HMAC-SHA256(CANDOR_PAYMENTS_LINK_KEY, job_id))`. The payments module
has its own SQLAlchemy engine and never imports report tables.

`POST /v1/reports/{id}/analysis` is protected by x402 (read `docs/research/x402.md`):
- Without `X-PAYMENT`: respond `402` with the x402 `PaymentRequirements` body (scheme `exact`,
  network `X402_NETWORK` default `base-sepolia`, USDC asset, `maxAmountRequired` from
  `analysis_price_usd`, `payTo` `X402_PAY_TO`, `resource` URL, description, `mimeType`,
  `maxTimeoutSeconds`, and `extra` with token name/version as required by the scheme).
- `X402_MODE=mock`: accept an `X-PAYMENT` whose decoded payload has `payload.mock == true` and a
  well-formed payer and nonce; record a mock payment, return `X-PAYMENT-RESPONSE` with a mock tx ref.
- `X402_MODE=testnet`: verify and settle through the facilitator (`X402_FACILITATOR_URL`) per the
  research notes, preferably using the official Python package if it fits FastAPI cleanly.
- Idempotency: `Idempotency-Key` header (or the payment nonce) maps to one job; replays return the
  same job without charging twice.

## Jobs

State machine with leases: `claim` picks the oldest `queued` job (or `leased` with expired lease),
sets `leased`, `lease_expires_at = now + 10 min`, increments attempts. Events move it to `running`.
`complete` stores findings and sets `succeeded`. `fail` with `retryable=true` requeues until
`max_attempts`, then `dead` (dead-letter, visible in admin endpoint). When `MODAL_ENABLED=true`,
enqueue also calls `modal.Function.from_name("candor", "run_analysis").spawn()` (see
`docs/research/modal.md`); otherwise the local worker polls.

## Endpoints

All JSON. Errors: `{"error": {"code": str, "message": str}}` with appropriate status. CORS for
`CANDOR_WEB_URL`. Rate limiting on public endpoints (token bucket per IP, in-memory). Request bodies
up to 40 MB on report submission.

Public and reporter:
- `GET /v1/health`
- `GET /v1/campaigns/{campaign_id}` -> `{campaign_id, org: {slug, name}, title, description,
  threshold, analysis_price_usd, identity_url, issuer: {key_id, spki}, enclave: {key_id, enc_pk},
  reviewers: [{reviewer_id, display_name, enc_pk}]}`
- `POST /v1/reports` (01-protocols submission) -> `201 {report_id, receipt: {evidence_root,
  log_index, sth}}`. Validate token signature with the campaign issuer key, reject spent tokens
  (`409 token_spent`), validate that shares cover exactly the campaign reviewers and the threshold
  matches, enclave key id matches, sizes within limits. Store, append `report.submitted`.
- `POST /v1/chaff` -> `204`, discards body.
- `POST /v1/inbox/challenge {sig_pk}` -> `{challenge, expires_at}`
- `POST /v1/inbox/session {sig_pk, challenge, signature}` -> `{token, expires_at, report_ids}`
- `GET /v1/inbox/messages` (inbox token) -> `{reports: [{report_id, status, messages: [{id,
  direction, box | boxes, created_at}]}]}`; replies only include the reporter's own boxes metadata.
- `POST /v1/inbox/messages {report_id, boxes: [{reviewer_id, box}], answers_count}` -> `201`

Reviewer (Bearer JWT):
- `POST /v1/auth/challenge {reviewer_id}`; `POST /v1/auth/token {reviewer_id, challenge, signature}`
- `GET /v1/me` -> reviewer profile and org
- `GET /v1/reports?status=` -> list `{report_id, campaign_id, status, received_bucket, file_count,
  size_bucket, analysis: {status, job_id, updated_at} | null, unread_replies, pending_access}`
- `GET /v1/reports/{id}` -> `{report, manifest_box, files: [{index, size}], my_sealed_share,
  findings: {job_id, box, sealed_key (for me), findings_sha256} | null, messages, access_requests}`;
  appends `findings.opened` when findings are returned.
- `GET /v1/reports/{id}/files/{index}` -> `{index, box}`; appends `evidence.fetched`.
- `PATCH /v1/reports/{id} {status}`
- `POST /v1/reports/{id}/analysis` (x402) -> `202 {job_id, status, payment: {...}}`
- `GET /v1/jobs/{job_id}` -> job with events
- `GET /v1/jobs/{job_id}/events` -> Server-Sent Events stream of `StageEvent` JSON (`event: stage`)
  plus a final `event: done`. Support `Last-Event-ID`. Accept the JWT via `?access_token=` because
  EventSource cannot set headers.
- `POST /v1/reports/{id}/access-requests {reason}` -> request
- `GET /v1/access-requests?status=pending` -> requests for my org with approvals so far
- `POST /v1/access-requests/{rid}/approve {resealed_share, signature}` -> verifies signature with the
  approver's `sig_pk`; requester cannot approve own request; when approvals >= threshold - 1 the
  status becomes `granted` and `access.granted` is logged
- `GET /v1/access-requests/{rid}` -> for the requester: status plus `resealed_shares` and the
  requester's own `sealed_share`
- `POST /v1/reports/{id}/messages {box, question_ids}` -> `201`

Transparency log (public):
- `GET /v1/log/key` -> `{key_id, public_key}`; `GET /v1/log/sth`; `GET /v1/log/entries?start=&end=`
  -> `[{index, entry_type, entry, leaf_b64u, created_at}]`;
  `GET /v1/log/proofs/inclusion?index=&tree_size=` -> `{index, tree_size, leaf_hash, audit_path}`;
  `GET /v1/log/proofs/consistency?first=&second=` -> `{first, second, proof}`;
  `GET /v1/log/anchors`

Admin (role admin): `GET /v1/admin/jobs?status=dead`, `POST /v1/admin/jobs/{id}/retry`,
`POST /v1/admin/anchor`, `GET /v1/admin/payments` (amounts and statuses only).

Worker (Bearer `CANDOR_WORKER_TOKEN`):
- `POST /internal/jobs/claim` -> `204` if none, else `{job_id, report_id, attempt, analysis:
  {sealed_key, box, enclave_key_id}, reviewers: [{reviewer_id, enc_pk}]}`
- `POST /internal/jobs/{id}/events` (StageEvent) -> `204`
- `POST /internal/jobs/{id}/complete {findings: FindingsEnvelope, summary: {stages: [{stage,
  status, duration_ms, llm_calls, cost_usd, provider, model}], metrics: {claims_total,
  citations_verified, ...}}}` -> `204`; `summary` must contain only counts, timings and model names.
- `POST /internal/jobs/{id}/fail {error, retryable}` -> `204`

Demo (only when `CANDOR_MODE=demo`):
- `GET /v1/demo/identities` -> seeded reviewers with their private keys (b64u) for one-click demo
  sign-in. Returns 404 in production mode.
- `GET /v1/enclave` -> `{key_id, enc_pk}`

## CLI (`candor-api`)

- `candor-api serve` (uvicorn), `candor-api seed --reset` creates org `northwind` ("Northwind
  Health"), campaigns `northwind-ethics` (threshold 2) and `northwind-safety` (threshold 2), three
  reviewers (Avery Chen admin, Morgan Ellis reviewer, Riley Park auditor) with fresh key pairs, an
  enclave key pair, a log signing key and a payments link key. Writes `data/demo/identities.json`
  (reviewer private keys), `data/demo/enclave.json` and appends secrets to `data/demo/.env.local`
  for the worker. Also registers campaigns with the identity service via
  `POST {CANDOR_IDENTITY_URL}/v1/admin/campaigns` (shared secret `CANDOR_IDENTITY_ADMIN_TOKEN`).
- `candor-api openapi > services/api/openapi.json`

## Tests

pytest covering: token verification with a real blind-signed token produced by a fixture (generate
an RSA key with `cryptography`, blind-sign with modular exponentiation in the test, finalize as per
RFC 9474 or use precomputed vectors), double-spend, share validation, job lease/expiry/DLQ, SSE
stream, x402 mock flow and idempotency, access quorum with Ed25519 signatures, inbox auth, Merkle
inclusion/consistency proofs against `docs/specs/vectors/protocol-vectors.json`, and that no log
entry or structured log line contains ciphertext or message bodies.
