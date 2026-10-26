# 00 · System overview and engineering rules

Candor is a privacy-preserving whistleblowing platform. Reporters disclose evidence while exposing as
little personal data as possible; reviewers receive a grounded, cited, uncertainty-aware account of
what happened. These specs are the contract between all services. When a spec and code disagree, the
spec wins unless the spec is updated in the same change.

## Trust domains and services

| Service          | Path                                                  | Lang                  | Port              | Holds                                                                                         | Never holds                                     |
| ---------------- | ----------------------------------------------------- | --------------------- | ----------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Web app          | `apps/web`                                            | Next.js 15, TS        | 3000              | nothing server-side; all crypto runs in the browser                                           | plaintext evidence on any server                |
| Identity service | `services/identity`                                   | Node 22+, Hono, TS    | 8787              | per-campaign RSA blind-signing keys, scoped nullifier tags, short-lived verification sessions | reports, evidence, payment data, raw proofs     |
| Report API       | `services/api`                                        | Python 3.12+, FastAPI | 8000              | ciphertext, sealed key shares, job queue, transparency log, payments ledger (separate DB)     | any plaintext evidence or keys able to open it  |
| Analysis worker  | `services/pipeline`                                   | Python 3.12+          | none (pulls jobs) | enclave X25519 private key, in-memory plaintext of the redacted analysis view only            | original evidence, pseudonym map, identity data |
| Evals            | `services/evals`                                      | Python 3.12+          | none              | synthetic scenarios, metrics, benchmark harness                                               | real data                                       |
| Client libraries | `packages/crypto`, `packages/privacy`, `packages/sdk` | TS                    | none              | used by the browser, the demo seeder and the eval scrubber CLI                                |                                                 |

Separation guarantees (talking points, must stay true in code):

1. Identity attestations, reports and payment records live in three different databases with no
   shared keys or foreign keys. `identity.db` (identity service), `reports.db` and `audit.db` (API),
   `payments.db` (API, payments module). Any linkage between payments and jobs is a keyed HMAC.
2. The identity service learns "a verified human asked for N tokens for campaign C" and nothing
   else. RFC 9474 blind signatures make the token it signed unlinkable to the token later redeemed.
3. The API stores only ciphertext. Originals and the pseudonym map are encrypted under a per-report
   key split k-of-n with Shamir and sealed to individual reviewers. The analysis view is sealed to the
   worker's enclave key. Findings are sealed back to reviewers.
4. Every access to evidence or findings is appended to an RFC 9162-style Merkle transparency log
   with signed tree heads.

## Data flow (happy path)

1. Reporter opens `/report/<campaign>`; browser fetches campaign descriptor from API (reviewer
   public keys, enclave public key, threshold, identity URL, issuer key).
2. Self verification (real QR or mock) at the identity service; scoped nullifier enforced; browser
   blinds 3 random token messages, identity service blind-signs, browser finalizes.
3. Browser strips metadata, extracts text, detects PII, pseudonymises, shows redaction diff and
   leakage risk; reporter approves.
4. Browser builds the encrypted submission (see 01-protocols) and redeems one token at the API.
   API verifies the RSA-PSS signature against the campaign issuer key, checks double-spend, stores
   ciphertext, appends `report.submitted` to the log, returns a receipt.
5. Reviewer signs in (Ed25519 challenge), requests analysis. The endpoint is x402-protected; the org
   pays per analysis. API enqueues a job. Worker claims it, unseals the analysis view, runs the
   multi-stage pipeline, streams stage events, seals findings to each reviewer, completes the job.
6. Reviewer reads the brief. To see originals or re-identify pseudonyms, a k-of-n quorum approves an
   access request; approvers re-seal their Shamir shares to the requester; browser combines.
7. Reviewer sends follow-up questions to the reporter's anonymous inbox; reporter logs in with the
   diceware codename (Argon2id-derived keys) and replies.

## Engineering rules (apply to every agent)

- No comments anywhere in source code: no `#`, `//`, `/* */`, no docstrings. Names and small
  functions carry meaning. Enforced by `eslint` rule `candor/no-comments` and
  `scripts/check_no_comments.py`. Markdown docs are the place for explanation.
- TypeScript: strict mode, ESM, Prettier (root `.prettierrc.json`), ESLint (root
  `eslint.config.mjs`). Tests with Vitest.
- Python: 3.12+, managed by `uv`, each service its own uv project with its own `pyproject.toml`,
  lockfile and `.venv`. Lint and format with Ruff using the root `ruff.toml` (run `uvx ruff@0.14.2
check` and `uvx ruff@0.14.2 format`). Tests with pytest. Type hints everywhere, Pydantic v2 for
  all boundary models.
- Never commit secrets. All config through env vars listed in `.env.example`.
- Every external integration (Meta Model API, Claude, Codex CLI, Fireworks, Baseten, Self, x402 facilitator,
  Modal, chain anchoring) sits behind an interface with a real implementation and a deterministic
  mock/replay implementation, selected by env var. Default `CANDOR_MODE=demo` must run fully offline
  except for the chosen LLM provider.
- Binary data in JSON is base64url without padding ("b64u"). Hashes as lowercase hex. Timestamps
  ISO 8601 UTC with `Z`. IDs are UUIDv4 strings unless a spec says otherwise.
- Every service has a `/health` (or `/v1/health`) endpoint and structured JSON logs that never
  contain payload contents, tokens or keys.

## Environment variables (root `.env.example` is canonical)

`CANDOR_MODE` (`demo` | `production`), `CANDOR_DATA_DIR` (default `./data`), `CANDOR_API_URL`,
`CANDOR_IDENTITY_URL`, `CANDOR_WEB_URL`, `CANDOR_WORKER_TOKEN`, `CANDOR_ENCLAVE_SK`,
`CANDOR_LLM_PROVIDER` (`claude` | `codex` | `meta` | `fireworks` | `baseten` | `replay`),
`CANDOR_CLAUDE_MODEL` (default `claude-haiku-5-5`), `ANTHROPIC_API_KEY` (optional),
`CANDOR_CODEX_MODEL` (default `gpt-6.1-sol`), `MODEL_API_KEY`, `CANDOR_META_MODEL` (default `muse-spark-1.3`),
`FIREWORKS_API_KEY`, `CANDOR_FIREWORKS_MODEL`, `BASETEN_API_KEY`, `CANDOR_BASETEN_MODEL`,
`CANDOR_BASETEN_BASE_URL`, `CANDOR_REPLAY_DIR`, `SELF_MODE` (`mock` | `staging` | `mainnet`),
`SELF_ENDPOINT`, `X402_MODE` (`mock` | `testnet`), `X402_PAY_TO`, `X402_NETWORK`,
`X402_FACILITATOR_URL`, `X402_PRICE_USD`, `ANCHOR_MODE` (`mock` | `evm`), `ANCHOR_RPC_URL`,
`ANCHOR_PRIVATE_KEY`, `MODAL_ENABLED`, `CANDOR_PAYMENTS_LINK_KEY`, `CANDOR_IDENTITY_SECRET`.

## Repository layout

```
apps/web                 Next.js app (design owned by the lead; backend agents do not edit)
packages/crypto          envelope encryption, Shamir, Padmé, blind RSA client, codename KDF, Merkle verify
packages/privacy         metadata stripping, text extraction, PII detection, pseudonymisation, leakage score, CLI
packages/sdk             typed API/identity client, submission builder, reviewer helpers, demo seeder CLI
services/identity        Self verification + blind issuance (Hono)
services/api             FastAPI report service, log, jobs, payments, inbox
services/pipeline        analysis DAG, providers, router, worker
services/evals           synthetic scenarios, metrics, eval runner, model benchmark
infra/modal              Modal app definitions
docs/specs               these specs
docs/research            verified SDK notes (read before integrating any third-party SDK)
```
