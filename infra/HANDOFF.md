# Infrastructure handoff

Implemented the Node-only development supervisor, safe reset/demo seeder, sequential Python test
runner, Modal app and deployment guide, three-job GitHub Actions workflow, and both requested
Playwright showcase flows. Only authorized paths were edited; no packages were installed and no
git state was changed.

The supervisor loads `.env` then `<CANDOR_DATA_DIR>/demo/.env.local` without overriding earlier
values, resolves data paths from the repository root, prefixes and redacts service output, gates
worker startup on the enclave key and backend readiness, and tears down managed children on
signals or unexpected exit. Service environments separate enclave/model credentials from API,
identity and web processes. Windows uses `taskkill /T /F /PID`; Unix uses detached process groups.

## Run

Configure `.env` from the existing example, stop the local API, then run:

```sh
pnpm seed
pnpm dev
pnpm dev --no-worker --no-web
pnpm test:py
pnpm e2e
node --test infra/tests/orchestration.test.mjs
uv run --project services/api pytest infra/tests -q -p no:cacheprovider
```

`seed` resets the API, starts temporary identity/API processes when needed, invokes the SDK's
`seed:demo`, and cleans up its own processes. It refuses to reset an active API because that
would invalidate its in-memory audit keys. SDK output is suppressed because it prints a codename.
Remove an explicitly empty `CANDOR_ENCLAVE_SK` from `.env` to let the generated demo environment
supply it. The worker defaults to Codex; configure a different provider explicitly as needed.

Playwright starts showcase mode at port 3100 unless `E2E_BASE_URL` points to an existing server.
Traces, screenshots and video are disabled so receipts and evidence are not persisted in artifacts.
The CI e2e job builds the web app, seeds, starts `dev --no-worker`, and runs these tests.
Python CI tests use replay/synthetic providers without secrets. Vitest excludes Playwright files.

See [Modal setup](modal/README.md) for `modal token new`, `candor-secrets`, deployment, storage,
and manual eval invocation. Local app construction succeeded without deployment or credentials.

## Verification

- Infrastructure Python: `8 passed, 4 warnings in 23.88s`.
- Node orchestration: `ℹ tests 19`, `ℹ pass 18`, `ℹ fail 0`, `ℹ skipped 1`,
  `ℹ duration_ms 1008.3203`. The skipped live Windows tree test is described below; deterministic
  tests verify the exact taskkill arguments and failure handling.
- API through `pnpm test:py`: `46 passed in 126.81s (0:02:06)`.
- Pipeline through `pnpm test:py`: `151 passed, 1 skipped in 22.60s`.
- Evals ordinary run: `13 passed, 42 errors in 9.71s`; all errors were sandbox temp-directory
  permissions. The runner correctly reported `[test:py] 2 passed, 1 failed, 0 not run.` and exited 1.
- Evals using its owner's documented test-only mkdir workaround: `55 passed in 46.00s`.
- ESLint, Prettier, standalone strict typechecking of the Playwright files, Ruff 0.14.2, and
  `python scripts/check_no_comments.py infra` passed. Ruff reported `All checks passed!` and
  `2 files already formatted`. The shared uvx cache is inaccessible, so the already-installed
  Ruff 0.14.2 executable was used; nothing was installed.
- Playwright discovery: `Total: 2 tests in 1 file`. Actual `pnpm e2e` exited 1 with
  `Error: spawn EPERM` before browser execution.

## Deviations and gaps

- The actual API module is `candor_api.app`, not `candor_api.main`. Its `serve` command has no
  `--reload`; development uses `uvicorn candor_api.app:create_app --factory --reload` instead.
  Modal follows the API's zero-argument `run_analysis()` invocation.
- Eval results mount beneath `services/evals/results`, satisfying the eval CLI's path restriction.
  Eval invocation is manual, preventing deployment from automatically scheduling paid inference.
- The SDK currently seeds one report and queues analysis; it does not provide the spec's two
  analyzed reports. This wrapper preserves that component's behavior and runs no hidden LLM calls.
- This Windows sandbox rejects piped child processes with `spawn EPERM` and `taskkill` with
  `ERROR: Access denied`. Dev startup and seed backend startup cannot complete here; the seed's
  actual API reset did complete. Tree cleanup failures are reported explicitly. The live tree
  test cleans up its own test processes and skips only after observing that restriction.
- For local validation, uv used `UV_CACHE_DIR=infra/.cache/uv`, `UV_NO_SYNC=1`, `UV_OFFLINE=1`.
  Evals' workaround changed mkdir permissions only inside its test interpreter, with temporary
  files in `infra/.artifacts/evals-safe`; production code and the runner remain unchanged.
- Modal image graphs and local wrappers were verified, but cloud builds, deployment, remote
  persistence and authenticated inference were not run. SQLite volumes use one container per
  database owner; abrupt failure can lose writes since the last volume commit. Hosted workers
  need a supported configured HTTP provider; images contain no authenticated Codex installation.
- API-reported analysis failures can return worker exit zero, so Modal retries alone do not
  guarantee a successful analysis. Queue status and leases remain authoritative.
- The reporter UI splits EFF words on internal hyphens; four wordlist entries contain hyphens.
  The eight-word assertion can expose that existing UI issue. No web component was changed.
