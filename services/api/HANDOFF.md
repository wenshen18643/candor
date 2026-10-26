# API handoff — security review, 2026-10-26

The report API implements encrypted submission, blind-token redemption, reviewer/inbox authentication, quorum custody, encrypted messages, a leased analysis queue, x402 payments, and a signed Merkle audit log across separate databases. This review fixed eight API findings and added adversarial regression coverage. Full findings and reviewed-safe areas are in [SECURITY_REVIEW.md](../SECURITY_REVIEW.md).

Changes:

- Hour-bucket new messages, signed tree heads, anchors, and payment timestamps. Inbox challenge subjects now use a challenge-specific HMAC instead of retaining the report's public key beside an exact expiry.
- Preserve message ordering and unread counts through additive `message_order` and `message_reads` tables. Startup backfills legacy ordering idempotently; existing ciphertext is unchanged.
- Require the current `X-Job-Attempt` on worker events, completion, and failure, including completion retries. Keep attempts monotonic across admin retries and allow three additional attempts per retry.
- Bind deterministic job IDs to reports so settled payments cannot switch reports after a report-database rollback. Original-report recovery remains idempotent.
- Bound SSE to four streams per reviewer and 64 per app, five-minute lifetimes, 15-second send timeouts, and batches of 100 events; recheck authorization while streaming and release slots on disconnect.
- Reject mock anchoring in production. Expanded tests cover cross-organisation routes, quorum signature context, duplicate/expired approval, migration, cancellation, and payment recovery.

## Run and validate

From the repository root, using installed dependencies:

```powershell
$env:UV_CACHE_DIR = "$PWD/services/api/.uv-cache"
uv run --no-sync --project services/api candor-api serve
uv run --no-sync --project services/api pytest services/api/tests -q --tb=line
uvx ruff@0.14.2 check services/api
uvx ruff@0.14.2 format --check services/api
python scripts/check_no_comments.py services
```

Set service configuration through the documented environment variables. For an unseeded offline demo, run `uv run --no-sync --project services/api candor-api seed` first. Production requires configured authentication/payment secrets, testnet payments, and EVM anchoring.

Final full-suite summary:

```text
64 passed in 108.18s (0:01:48)
```

Ruff 0.14.2: `All checks passed!`; `31 files already formatted`. Repository services no-comments check: exit 0. The shared uv cache is not writable here, so Ruff ran from the existing 0.14.2 executable with its cache under API data; pytest used the component cache and `--no-sync`. No packages were installed.

## Integration requirements and remaining limits

**The current pipeline worker does not send `X-Job-Attempt`.** It must send claim's `attempt` with events, complete, and fail before end-to-end analysis works with this API. Missing/stale values return 409. Pipeline was explicitly out of scope and was not modified.

The attempt header, monotonic lifetime attempt count, bounded SSE lifetime, and extra message bookkeeping tables are deliberate contract extensions for the requested security guarantees. Legacy messages may appear unread once; old in-flight inbox challenges must be refreshed. Deploy API instances together so all writers populate message ordering. Existing completed payment jobs remain replayable; orphaned settlements from the previous job-ID derivation require reconciliation.

Existing precise historical data and published signed heads are not rewritten. Hour buckets cannot prevent live traffic correlation, sparse-hour inference, filesystem/WAL timing, or public-chain timing. Exact short-lived authentication expiry remains necessary; the inbox HMAC assumes the API secret is not compromised alongside the database. Fixed issuer keys cannot enforce token epoch expiration without a coordinated protocol change. Uncertain settlements still require operator reconciliation. No live PostgreSQL, funded testnet settlement, EVM publication, or Modal invocation was tested during this review.
