# Identity handoff — security review, 2026-10-26

The identity service implements Self verification, campaign-scoped encrypted RSA issuers, RFC 9474 blind issuance, transactional epoch quotas, short-lived sessions, and SQLite/in-memory stores. This review fixed three identity findings; [SECURITY_REVIEW.md](../SECURITY_REVIEW.md) records all backend findings and reviewed-safe areas.

Changes:

- Production requires `SELF_MODE=mainnet`; mock and staging verification are rejected. Invalid `CANDOR_MODE` values also fail startup.
- Request logs use hour-bucket timestamps and omit durations and response-correlated request IDs. Bodies, proofs, nullifiers, credentials, and session identifiers remain excluded.
- All `/v1` routes have per-socket-peer and global token buckets, a bounded peer map, and a 16-request concurrency cap. Forwarded-address headers cannot bypass the limiter. Self callbacks preserve the required HTTP-200 error response shape.

## Run and validate

Use Node 24+ and the existing installed dependencies. Configure `CANDOR_IDENTITY_SECRET`, `CANDOR_IDENTITY_ADMIN_TOKEN`, and the service URLs through the documented environment variables; real verification requires a public HTTPS callback.

```powershell
pnpm --filter @candor/identity build
pnpm --filter @candor/identity start
pnpm --filter @candor/identity test
pnpm --filter @candor/identity typecheck
pnpm exec eslint services/identity
pnpm exec prettier --check "services/identity/src/**/*.ts" "services/identity/tests/**/*.ts"
```

Final full-suite summary:

```text
Test Files  5 passed (5)
     Tests  61 passed (61)
  Duration  3.88s (tests 77%, import 18%, transform 4%, worker 1%)
```

Typecheck, TypeScript build, ESLint, and Prettier pass. No source comments were introduced. Tests include real blind-sign/finalize/verify operations, SQLite restart and concurrent quota enforcement, Self adapter policy, deployment guards, rate-limit recovery, forwarded-address spoofing, and concurrent-verifier capacity release. No packages were installed or pnpm stores changed.

## Decisions and limits

Admission limits are 60 requests per peer with one token/second refill, 600 globally with ten/second refill, 16 in flight, and at most 10,000 peer records. Limits are per process and use the real socket peer; behind a proxy, clients share that peer's limit unless deployment supplies a separately trusted ingress policy. IPs remain only in transient limiter memory and are never logged or persisted.

The existing service retains precise short-lived expiry for the mandatory 15-minute session TTL and purges expired sessions. Removing request timing does not eliminate live-network, storage, or external-proxy correlation. No mobile staging/mainnet proof was exercised; the official SDK constructor is tested with its proof operation mocked. Production staging rejection is intentional because staging accepts mock passports.

Existing protocol limitations remain: fixed issuer keys do not authenticate token epochs; issuance enforces quota epochs, but redemption expiry needs a coordinated protocol/client change. Committed blind signatures cannot be recovered if their response is lost because messages and signatures are not retained. Native OpenSSL raw RSA signing, SDK-compatible signature checks, encrypted issuer storage, and scoped HMAC nullifier tags remain unchanged.
