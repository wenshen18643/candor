# Live reviewer console

Implemented `createLiveClient(): ConsoleClient` using the existing SDK: Ed25519 authentication, report mapping, authenticated findings and reply decryption, x402 quotes and payments, settlement-header receipts, resumable authenticated SSE, signed quorum approvals, manifest and file integrity verification, status changes, and sealed follow-ups. JWTs, secret keys, payment authorizations and opened content remain in memory. Approval uses a separate session and preserves the requester session. Payment retries reuse the authorization and idempotency key.

Only `live.ts`, `live.test.ts`, this handoff, and the initial `client` expression in `store.ts` were changed. The store expression lazily loads the live client when `showcaseMode` is false, preserving the import section and all other store behavior. No packages were installed or UI files edited.

## Run and verification

Configure `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_IDENTITY_URL`, start the API and identity service in demo/mock mode, and select a reviewer in the existing console.

```sh
pnpm exec eslint apps/web/src/lib/console
pnpm exec prettier --check apps/web/src/lib/console
pnpm --filter @candor/web exec tsc --noEmit
pnpm --filter @candor/web exec vitest run src/lib/console --pool=threads
```

ESLint, Prettier and TypeScript pass. Final test summary:

```text
Test Files  1 passed (1)
     Tests  25 passed | 1 skipped (26)
  Duration  4.33s (import 67%, tests 20%, transform 12%)
```

Tests mock HTTP while executing real signing, sealing, findings verification, Shamir reconstruction and evidence decryption. They cover mapping, replies, status changes, settlement headers, chunked SSE, failed/dead jobs, payment retries, wallet signing, and tamper rejection.

The exact requested Vitest command without `--pool=threads` failed before running tests because Windows denied child-process spawning (`spawn EPERM`). Threads run the same suite successfully.

The opt-in local integration test uses `CANDOR_E2E=1`, the two public service URLs, and `CANDOR_WORKER_TOKEN` matching an isolated API. It submits through real blind issuance, exercises custody and inbox traffic, pays, and publishes synthetic encrypted worker findings to test SSE completion. It does not run an LLM. This integration test remains unverified: automatic approval review rejected the isolated service-launch/seed command with **“blocked by policy”**. No live-service success is claimed.

## Contract decisions and gaps

- Returned demo identities have empty secret-key fields; their actual keys stay inside the client. This prevents the existing store's identity persistence from saving secrets. Signing accepts these public identities and reloads demo keys if needed.
- The current API does not advertise `X402_MODE`. Explicit quote `extra.mode` or `extra.x402_mode` takes precedence; otherwise availability of the demo-identities endpoint selects mock, and its 404 selects testnet. Demo deployments using testnet must advertise the mode. The testnet implementation uses an injected browser wallet; no funded settlement was exercised.
- The API omits the submission log index from report details. The client resolves it from paginated public audit entries. Claim counts become available after findings are opened; running snapshots have no stage name.
- Historical outbound messages are encrypted only to the reporter, and the API returns only their metadata to reviewers. Their body is empty after reload; messages sent during the current session retain their text in memory.
- `UnlockedEvidence` exposes metadata and the pseudonym map, not file bytes or a modified analysis. Every file is decrypted and verified, then its bytes and the reconstructed key are cleared. Existing UI reidentification remains unchanged.
- JWTs deliberately do not survive reload. The existing UI retains the public identity but does not automatically reauthenticate it; after reload, sign out and select the reviewer again. UI lifecycle changes are outside the allowed scope.
