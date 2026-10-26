# Pipeline handoff

Implemented the twelve-stage asynchronous DAG, stage events and run metrics; provider registry and per-stage routing; Meta/Fireworks/Baseten Chat Completions, Codex subprocess, replay, chaos and tap providers; strict schema generation, semantic validation, bounded repair and salvage; spotlighting and injection quarantine; self-consistency clustering, citation grounding, verification, temporal normalization and STN conflict extraction, union-find entities, contradictions, calibration, follow-up questions and cited briefs. Added enclave encryption, the pull worker, CLI, synthetic fixtures and offline cassettes. The fixed contracts have no field additions, removals or renames.

## Run

From the repository root, with the canonical environment variables exported:

```powershell
uv sync --project services/pipeline
uv run --project services/pipeline pytest services/pipeline/tests -q
$env:CANDOR_REPLAY_DIR = 'services/pipeline/tests/cassettes/synthetic'
uv run --project services/pipeline candor-pipeline run services/pipeline/tests/fixtures/synthetic_payload.json --provider replay
uv run --project services/pipeline candor-worker --once
```

The worker requires `CANDOR_API_URL`, `CANDOR_WORKER_TOKEN`, `CANDOR_ENCLAVE_SK` and the selected provider configuration. Continuous mode polls every 1.5 seconds. `DAGRunner` automatically reads `services/pipeline/router.json` when no explicit provider/router configuration is supplied; CLI routing accepts `--router PATH`. Health is available through `candor-pipeline health`.

## Verification

Final pytest summary: **`149 passed, 1 skipped in 46.81s`**.

`uvx ruff@0.14.2 check services/pipeline`: **All checks passed!**

`uvx ruff@0.14.2 format --check services/pipeline`: **49 files already formatted**.

`python scripts/check_no_comments.py services`: **exit 0**.

Tests cover shared CandorBox, Padmé and key-ID vectors; authenticated encryption and reviewer decryption; all stage algorithms; repairs and malformed outputs; provider HTTP requests/retries with respx; Windows subprocess arguments, timeouts and event validation; DAG concurrency, failure handling, event dependencies; worker claims/events/encrypted completion; and deterministic replay. The offline CLI completed all twelve stages with one supported claim and one verified citation. No Meta inference request was made.

## Live Codex result and remaining gap

Attempted the tiny-schema probe with installed `gpt-6.1-sol`. The native CLI failed before inference with **`failed to initialize in-process app-server client: Access is denied. (os error 5)`**. After unit tests passed, performed exactly one end-to-end CLI invocation with `--provider codex --synthetic --record services/pipeline/tests/cassettes/codex`; it exited 1 without producing a cassette. Existing research notes independently document the sandbox restriction and a successful invocation from a normal shell.

The requested successful live run is therefore **not verified**. Its replay test is explicitly skipped until genuine cassettes exist. The separately labelled `synthetic/` cassettes are deterministic test-provider outputs, not Codex outputs. [Recording instructions](tests/cassettes/README.md) and the live replay test are ready for an authenticated terminal outside this sandbox. No credentials were copied or persisted to work around the restriction.

## Deliberate deviations and limits

- Codex uses captured JSONL stdout instead of `-o`: evidence-derived output stays in memory. Only the schema is temporarily written. It uses the native executable, UTF-8 stdin, a 240-second timeout, a semaphore, ephemeral sessions, disabled tool features and rejection of unexpected tool events.
- HTTP providers use `httpx` directly because the installed OpenAI SDK uses `httpx2`, while the required respx tests target `httpx`. Wire formats follow the research notes. Paid providers were tested with mocks, not authenticated inference. Prices are estimates; unlisted models and Codex report zero monetary cost because pricing is unavailable, not because usage is necessarily free.
- Recording, optional tap files and plaintext CLI result files require an explicit synthetic-data opt-in. Production worker findings are sealed to reviewers. Replay manifests retain the synthetic nonce for exact request hashes.
- Missing document anchors produce an unknown interval over the representable date range instead of inventing a reference date. Identical document text counts as one source. Injection classification cannot lower a high-risk heuristic finding.
- Health is a CLI command rather than an HTTP endpoint, preserving the component's portless pull-worker design. Model context/output limits still apply to large submissions; this component does not implement document-level context sharding.

All edits are confined to `services/pipeline/**`; no git state was changed.
