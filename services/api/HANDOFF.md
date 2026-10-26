# API handoff

Implemented all specified endpoint families and the `candor-api serve`, `seed --reset`, and `openapi` commands. `openapi.json` contains 36 paths and 67 schemas.

- Separate SQLAlchemy reports, audit, and payments databases; startup schema creation; SQLite WAL transactions and PostgreSQL/psycopg support; atomic content-addressed local blob storage.
- Identity-backed campaign descriptors with cached public issuers and lazy registration/retrieval retries. RSA private keys are generated only in tests. RFC 9474 SHA-384/PSS token verification, transactional double-spend protection, and recipient/threshold/enclave validation.
- Single-use Ed25519 reviewer/inbox challenges, scoped JWTs, encrypted messaging, per-reviewer unread tracking, and signature-verified access quorum.
- Durable job queue, ten-minute leases, retries, dead letters, findings storage, resumable authenticated SSE, and optional Modal spawning.
- RFC 9162 trees, inclusion/consistency proofs, persistent Ed25519 signed heads, startup integrity verification, durable audit outbox, and mock/EVM raw-RPC anchoring.
- x402 v1 mock/facilitator adapters, idempotency and nonce replay protection, HMAC-only payment/job linkage, bounded requests, rate limiting, CORS, and payload-free structured logs.

## Run

From the repository root in PowerShell:

```powershell
$env:CANDOR_DATA_DIR = "$PWD/services/api/data"
uv sync --project services/api
uv run --project services/api candor-api seed --reset
uv run --project services/api candor-api serve
```

Configure the identity admin token and service URLs using the documented environment variables. Seed continues with clear warnings when identity is unavailable; campaign descriptors retry later. Seed writes `demo/identities.json`, a public-only `demo/enclave.json`, and worker secrets in `demo/.env.local` beneath `CANDOR_DATA_DIR`. `serve` reads this environment file; environment variables take precedence. The API settings deliberately exclude the enclave private key.

```powershell
uv run --project services/api pytest services/api/tests -q
uvx ruff@0.14.2 check services/api
uvx ruff@0.14.2 format --check services/api
python scripts/check_no_comments.py services
```

## Verified

Final full-suite summary: **`46 passed in 114.25s (0:01:54)`**.

Ruff: **`All checks passed!`**, **`30 files already formatted`**. Repository services no-comments check: exit 0. Lockfile check passed. Actual CLI seed and HTTP serve smoke checks passed. Tests include real RFC 9474 preparation/PSS encoding/blinding/raw-RSA signing/unblinding, concurrent redemption and payment races, every shared Merkle vector, queue/SSE/quorum/inbox flows, privacy checks, restart recovery, and HTTP/RPC adapter tests. Live facilitator discovery returned HTTP 200 and advertised v1 exact/Base Sepolia support.

## Deliberate differences and remaining limits

- The x402 402 challenge uses the protocol's string `error`; ordinary API errors use the specified structured object. The current SDK research confirms the required v1 wire format.
- Worker event `detail` is discarded and failure text becomes fixed error codes, preventing accidental plaintext persistence. Numeric summaries and constrained provider/model identifiers remain available.
- Extra audit-outbox and read-tracking tables provide crash recovery and meaningful unread counts. Optional `X-Job-Attempt` rejects stale attempts; existing workers remain compatible without it, so full stale-worker fencing requires worker adoption.
- Ambiguous facilitator settlement stays `settling` and blocks automatic recharging. Operator reconciliation is required before resolving that record. No funded testnet transaction, authenticated Modal cloud invocation, or live PostgreSQL server was available for validation.
- Tests use component-local ignored scratch storage because Windows denies access to pytest's restricted temporary directories. Automatic approval review rejected recursive cleanup of three generated cache folders with “blocked by policy”; nonrecursive removal also failed on Windows permissions. They remain ignored; test caching is disabled. No source rules were relaxed.

Integration references: [x402 v1 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v1.md), [Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/), [Modal function invocation](https://modal.com/docs/guide/function-calling), plus the repository's verified research notes.
