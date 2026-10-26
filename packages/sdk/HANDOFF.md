# SDK handoff

Implemented the fetch-based browser/Node SDK, OpenAPI-generated API types, encrypted submission
builder, identity and blind-token flow, reviewer custody and findings helpers, anonymous inbox,
x402 v1 payments, resumable SSE, transparency verification, and working synthetic demo CLI.
All edits are inside `packages/sdk`; no dependencies were installed. `contracts.generated.ts`
was left unchanged.

## Run

From the repository root:

```powershell
pnpm --filter @candor/sdk api:generate
pnpm --filter @candor/sdk seed:demo
pnpm exec eslint packages/sdk
pnpm exec prettier --check packages/sdk --ignore-path packages/sdk/.prettierignore
pnpm --filter @candor/sdk typecheck
pnpm --filter @candor/sdk test
```

The CLI uses `CANDOR_API_URL` and `CANDOR_IDENTITY_URL`, defaulting to localhost ports 8000 and 8787. Run the seeded API and identity service with demo mode, `SELF_MODE=mock`, and
`X402_MODE=mock`. The CLI verifies a synthetic persona, mints three actual blind-signed tokens,
submits synthetic evidence, verifies its receipt, authenticates all seeded reviewers, pays,
and queues analysis. It prints only the requested codename and public report/job/log metadata.
It stops when analysis is queued; no worker or LLM is required. The queued state establishes
that no worker has claimed the job yet, not that no worker process exists.

Run the gated live integration against existing services with `$env:CANDOR_E2E='1'` and the
same test command. The optional Windows harness creates isolated runtime data and ephemeral
configuration, seeds services, runs the complete suite and CLI, and stops its direct child
processes:

```powershell
powershell -NoProfile -File packages/sdk/tests/start-local.ps1 -BuiltIdentity -IdentityPort 8788 -ApiPort 8001
```

`-BuiltIdentity` uses the identity engineer's existing `dist/main.js`; omit it to run the
requested `pnpm --filter @candor/identity dev`. New harness data and uv cache live beneath
`packages/sdk/node_modules/.sdk-e2e`, outside source discovery. No pnpm store was created or
changed. The harness runs `uv run --no-sync --project services/api candor-api seed --reset`
and the installed API Python entry point to avoid dependency or source mutations.

## Validation

Final live run, including every unit test and the gated real-service test:

```text
Test Files  5 passed (5)
     Tests  26 passed (26)
  Duration  5.80s (import 61%, tests 25%, transform 14%)
Integration exit: 0; demo CLI exit: 0
```

ESLint and TypeScript pass. Prettier passes with the component ignore file shown above.
The ordinary test run skips only the live-service test: `Tests 25 passed | 1 skipped (26)`.

Coverage includes actual RSA blinding/raw signing/finalization with mocked fetch; route methods,
bodies, safe errors and credential separation; all three 2-of-3 quorum combinations; enclave
analysis decryption; wrong keys, digests and report contexts; original/redacted variants;
receipt substitution; encrypted questions/replies; EIP-3009 typed data and deterministic mock
payments; immutable re-identification; SSE chunking, UTF-8, CR/CRLF, reconnects, duplicate cursors,
abort, auth expiry and size limits; signed heads, inclusion and consistency proofs.

The live test additionally verifies real identity/API interoperability, double-spend rejection,
status changes, API-verified quorum approvals, manifest/file recovery, inbox sign-in and replies,
mock settlement, queued analysis, and append-only log growth. It uses real HTTP and SQLite.

## Usage and trust boundaries

Construct `CandorClient` with explicit `apiUrl` and `identityUrl`, optionally an injected `fetch`.
Reviewer and inbox tokens have separate in-memory slots. Public/identity requests do not receive
the reviewer's bearer automatically. Redirects are rejected. `CandorError` exposes `status` and
the API `code`; its message deliberately excludes server-provided text and request bodies.

`buildSubmission({ campaign, token, files, variants, scrub, statementKey, onStep })` returns
`{ body, codename }`. Pass **only `body`** to `client.submit`. This keeps the codename out of
the exact API wire body. Files must already be stripped with the privacy package. Every file
needs an explicit variant; redacted files require scrubbed text. Unsupported files and files
with remaining metadata are rejected. The supplied scrub result represents the reporter's
approved review; the SDK does not silently invent additional redaction decisions.

All six `onStep` events contain public identifiers/counts only. Metadata previews are fully
masked as `***`. Report/analysis keys and temporary shares are overwritten after sealing.
`submit` defaults to CSPRNG-selected 2–20-second jitter and checks returned report/root identity;
tests and the synthetic CLI explicitly use zero jitter. `sendChaff` is opt-in.

`openFindings` authenticates the box, checks its exact plaintext-byte hash and report identity.
`decryptManifest` can check the evidence root; `decryptFile` checks the manifest digest and size.
`combineReportShares` rejects an insufficient quorum or repeated share coordinates. The caller
owns returned plaintext, inbox keys, and reconstructed report keys and should discard/overwrite
them when finished. `reidentifyResult` creates a display copy, preserving structural IDs,
entity placeholders, graph references and committed hashes. Citation offsets and hashes still
refer to the original pseudonymised result; do not submit the display copy as a new analysis.

`verifyReceipt`, `getVerifiedTreeHead`, and consistency helpers require an explicitly supplied
trusted log public key. Fetching `/v1/log/key` alone is trust-on-first-use, not an independent
trust anchor. Verification hashes the transmitted leaf bytes, not a reserialized entry object.

`streamJobEvents` yields typed `stage`/`done` events, uses Authorization headers, resumes with
`Last-Event-ID`, and retries transient failures/disconnects up to five times by default. Pass an
AbortSignal to stop waiting. Auth expiry is an error. `createPayment` selects mock/testnet from
explicit `mode` or Node's `X402_MODE`; browser callers should select explicitly. Testnet uses a
`WalletSigner.signTypedData` interface for EIP-3009 on Base Sepolia. Mock payments are deterministic
when supplied the same payer/nonce. For safe retry after an ambiguous payment request, retain
the payment header and idempotency key and call `startAnalysis` again with those same values.

## Exact public exports

Runtime exports from `src/index.ts`:

`CandorClient`, `CandorError`, `buildSubmission`, `createPayment`, `combineReportShares`,
`createApproval`, `decryptFile`, `decryptManifest`, `openFindings`, `openMessage`,
`reidentifyResult`, `sealQuestion`, `sealReply`, `parseSse`, `streamJobEvents`,
`verifyLogConsistency`, `verifyLogInclusion`, `verifySubmissionReceipt`, `verifyTreeHead`.

Type exports:

`components`, `operations`, `paths`, `ClientOptions`, `AnalysisPayload`, `AnalysisResult`,
`StageEvent`, `PaymentAuthorization`, `PaymentOptions`, `WalletSigner`, `WalletTypedData`,
`JobEvent`, `ServerEvent`, `StreamOptions`, `Fetch`, `RequestOptions`, `BuildSubmissionInput`,
`BuiltSubmission`, `Campaign`, `ConsistencyProof`, `DemoIdentity`, `InboxQuestion`, `InboxReply`,
`InclusionProof`, `Issuance`, `LogKey`, `Manifest`, `ManifestFile`, `PaymentRequirements`,
`Question`, `ReportDetail`, `ReportStatus`, `Schemas`, `SealStep`, `SelfSession`, `Submission`,
`Submitted`, `Verification`.

Public `CandorClient` methods:

`setToken`, `setInboxToken`, `signOut`, `loadCampaign`, `startVerification`, `mockVerify`,
`pollVerification`, `waitForVerification`, `issueBlindTokens`, `mintTokens`, `submit`,
`sendChaff`, `signIn`, `listIdentities`, `listReports`, `getReport`, `getFile`, `setStatus`,
`quoteAnalysis`, `startAnalysis`, `payAndRunAnalysis`, `getJob`, `streamJobEvents`,
`requestAccess`, `listAccessRequests`, `getAccessRequest`, `approveAccess`,
`signAndApproveAccess`, `sendQuestions`, `signInInbox`, `getInboxMessages`, `readInbox`,
`reply`, `getLogKey`, `getTreeHead`, `getLogEntries`, `getInclusionProof`,
`getConsistencyProof`, `getAnchors`, `getVerifiedTreeHead`, `verifyConsistency`, `verifyReceipt`.

## Deviations and remaining limits

- Windows blocked the requested identity dev command and original `tsx` CLI with esbuild
  `spawn EPERM`. Live validation used the existing built identity service and explicit IPv4
  ports 8788/8001. The final demo command works using Node's module loader and the already
  installed root TypeScript compiler in process. No additional package was needed.
- The first uv run could not access its shared cache. The harness uses a component-local uv
  cache and `--no-sync`. Its final direct child processes shut down successfully. Earlier
  shell-wrapped processes could not be enumerated/stopped through Windows process APIs.
- The exact unfiltered `pnpm exec prettier --check packages/sdk` found four generated runtime
  JSON files under the initial `.e2e` scratch directory, not source formatting problems.
  Automatic approval review rejected both recursive cleanup and narrower explicit-file cleanup
  with **“blocked by policy”**. Those files remain untouched and git-ignored. Use the component
  `.prettierignore` override to check all source without scanning runtime credentials; the
  unfiltered command remains affected until that scratch directory can be removed.
- Real passport verification, funded testnet settlement, an actual browser wallet and a live
  analysis worker were not exercised. Self mode is owned by the identity service; wallet typed
  data is tested with an injected signer. Findings decryption and enclave payload compatibility
  are verified cryptographically in tests. The CLI deliberately stops after queueing.
- Validation ran on Node 24.15.0. Browser-compatible SDK code uses Web APIs and has no Node-only
  imports; the CLI loader is isolated from the package entry point. Browser bundling and Node
  22 runtime execution were not separately tested. The SDK tsconfig includes the privacy
  package's existing browser declaration files so its exported source types resolve correctly.
