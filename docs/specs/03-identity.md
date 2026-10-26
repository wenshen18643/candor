# 03 · Identity service (`services/identity`)

Node 22+, TypeScript (strict, ESM), Hono with `@hono/node-server`, package name
`@candor/identity`. Storage through a small `Store` interface with a `node:sqlite` implementation
(file `CANDOR_DATA_DIR/identity.db`) and an in-memory implementation for tests. Vitest for tests.
Read `docs/research/self-protocol.md` and `docs/research/blind-rsa.md` before writing integration
code. Port 8787.

## What it stores

- `campaigns(id, scope, issuer_private_jwk_encrypted, issuer_spki, key_id, tokens_per_epoch,
  epoch_days, created_at)`. Issuer private keys are encrypted at rest with
  `CANDOR_IDENTITY_SECRET` (AES-256-GCM via WebCrypto, key derived with HKDF-SHA256).
- `sessions(id, campaign_id, status ['pending' | 'verified' | 'rejected' | 'consumed'], allowance,
  reason, created_at, expires_at)` with 15-minute TTL and a purge loop. No proof data is kept.
- `nullifier_tags(tag PRIMARY KEY, campaign_id, epoch, issued)` where
  `tag = hex(HMAC-SHA256(CANDOR_IDENTITY_SECRET, campaign_id || "|" || epoch || "|" || nullifier))`.

It never stores names, document numbers, nationality, dates of birth or raw proofs.

## Scope

Self scope per campaign: `"candor-" + campaign_id` truncated to Self's scope limits (check the
research notes for allowed length/charset). Because Self nullifiers are scoped, the same person gets
different nullifiers in different campaigns: reports to different organisations are unlinkable,
while repeat issuance inside one campaign is rate limited.

## Endpoints

- `GET /health`
- `POST /v1/admin/campaigns {campaign_id, tokens_per_epoch?, epoch_days?}` (Bearer
  `CANDOR_IDENTITY_ADMIN_TOKEN`) -> creates or returns the campaign with a fresh RSA-2048 issuer key
  generated with `@cloudflare/blindrsa-ts` (RSABSSA-SHA384-PSS-Randomized). Idempotent.
- `GET /v1/campaigns/{campaign_id}/issuer` -> `{campaign_id, alg: "RSABSSA-SHA384-PSS-Randomized",
  key_id, spki}`
- `POST /v1/sessions {campaign_id}` -> `{session_id, expires_at, self: {mode, scope, endpoint,
  app_name: "Candor", user_id: session_id, user_id_type: "uuid", disclosures: {minimumAge: 18,
  ofac: false}}}`
- `POST /v1/self/verify` -> the endpoint the Self relayer calls. Verify with the official backend
  verifier per research notes (staging uses mock passports). On success compute the tag from the
  proof's nullifier and the campaign derived from the session `user_id`, check the epoch quota
  (default 3 tokens per 30 days), set the session `verified` with `allowance = min(3, remaining)`,
  or `rejected` with reason `quota_exhausted` / `proof_invalid` / `age_requirement`. Respond in the
  exact shape the relayer expects.
- `POST /v1/sessions/{id}/mock-verify {persona}` (only `SELF_MODE=mock`) -> nullifier
  `sha256("candor/mock-self/" + persona + "/" + scope)`; same quota logic. Lets the demo show that a
  second report from the same persona in the same campaign is rate limited while a different
  campaign is unaffected.
- `GET /v1/sessions/{id}` -> `{status, allowance, reason}` (polled by the browser)
- `POST /v1/sessions/{id}/issue {blinded_messages: [b64u]}` -> `{blind_signatures: [b64u], key_id,
  epoch_ends_at}`; requires `verified`, at most `allowance` messages, then sets `consumed`.

CORS for `CANDOR_WEB_URL`. Structured logs without nullifiers, tags or blinded messages.

## Tests

Full flow with the in-memory store: create campaign, create session, mock-verify, blind three
messages client-side with blindrsa-ts, issue, finalize, verify signatures; quota exhaustion on the
fourth token in the epoch; cross-campaign independence; session expiry; tag never equals raw
nullifier.
