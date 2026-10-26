Implemented the complete identity service with a testable `createApp()` Hono factory and runnable `src/main.ts`: authenticated, idempotent campaign creation; RSA-2048 issuer keys encrypted with HKDF-SHA256/AES-256-GCM; SQLite and memory stores; 15-minute sessions and purge loop; scoped HMAC nullifier tags; atomic quota consumption and single-use issuance; CORS; bounded requests; privacy-safe JSON logs; and graceful shutdown.

Self integration uses the official `@selfxyz/core@1.2.0-beta.1` off-chain verifier for staging/mainnet, with proof-bound UUID routing, age checks, a 20-second verification deadline, and provider cleanup. Passport and biometric-ID attestations are enabled. Relayer replies use HTTP 200 with `status`/`result` and a safe `reason` on rejection. Callback retries preserve terminal session states. `SELF_MODE=mock` enables deterministic persona verification; real modes disable that endpoint. Proofs and personal disclosures are never persisted or returned.

Run from the repository root with Node 24+ and the environment variables in `.env.example` configured:

```sh
pnpm --filter @candor/identity build
node --env-file=.env services/identity/dist/main.js
```

Alternatively, export the environment and run `pnpm --filter @candor/identity start`. Defaults are port 8787, `./data/identity.db`, and mock Self verification. `CANDOR_IDENTITY_SECRET` and `CANDOR_IDENTITY_ADMIN_TOKEN` are required, at least 24 characters; use independently generated high-entropy values. Preserve the identity secret across restarts. Real Self modes require a public HTTPS `SELF_ENDPOINT`. Production rejects mock mode and the example development credentials.

Validation on Node 24.15.0:

```text
Test Files  4 passed (4)
     Tests  54 passed (54)
  Duration  3.93s (tests 63%, import 22%, transform 14%, worker 1%)
```

ESLint, Prettier, typecheck, build, and the component no-comments checker pass. Tests cover the complete blindrsa-ts client flow, native/SDK signature equivalence, both stores, restart persistence, concurrent issuance across SQLite connections, quota and campaign independence, epoch rollover, expiry during asynchronous work, malformed input, encryption tampering, safe logs, and Self callbacks with mocked verification. A separate built-server HTTP/SQLite smoke test finalized and verified a token and completed graceful shutdown.

Implementation decisions and deviations:

- Sessions additionally retain only a scoped `tag` and `epoch` until consumption or TTL purge, allowing atomic quota enforcement after restart. No raw nullifier is stored.
- Epochs are UTC intervals anchored at the Unix epoch. Crossing an epoch requires a new verification session. Scopes use the SDK's 31-ASCII-character limit; truncation collisions fail closed.
- Cloudflare generates issuer keys; the server uses native OpenSSL raw RSA with input validation and a public-exponent fault check for signing, avoiding the SDK's JavaScript private-exponent operation. Signatures are byte-identical to `blindSign()` and pass client finalization and SHA-384/PSS verification.
- Build uses TypeScript emit instead of tsup because esbuild subprocesses are blocked in this Windows sandbox. Vitest uses native config loading and worker threads. The authorized pnpm dependency command updated the shared lockfile; installation used a component-local store because the existing shared store was read-only.

Known gaps: a mobile Self staging/mainnet proof has not been exercised; the real SDK constructor and adapter are tested with its proof method mocked. Self labels this SDK legacy; it is retained to honor the specified self-hosted architecture. The protocol's fixed issuer key and token wire format do not authenticate an epoch, so `epoch_ends_at` describes issuance quota timing and cannot independently enforce token expiration at redemption. Tokens lost after a committed issuance response are not recoverable because signatures and blinded messages are never retained.
