Only explicitly synthetic evidence may be recorded here. No real evidence, credentials, or request bodies belong in this directory.

`codex/run.json` is created only after a successful live run. The live recording test is skipped until that manifest and its response cassettes exist; synthetic model responses are never presented as a Codex recording.

From a normal authenticated terminal at the repository root:

```powershell
uv run --project services/pipeline candor-pipeline run services/pipeline/tests/fixtures/synthetic_payload.json --provider codex --synthetic --record services/pipeline/tests/cassettes/codex
uv run --project services/pipeline pytest services/pipeline/tests/test_codex_recorded.py -q
$env:CANDOR_REPLAY_DIR = 'services/pipeline/tests/cassettes/codex'
uv run --project services/pipeline candor-pipeline run services/pipeline/tests/fixtures/synthetic_payload.json --provider replay
```

The manifest preserves the random spotlight nonce and synthetic fixture digest, allowing exact replay keys while normal pipeline runs continue to use fresh random nonces.

`synthetic/` contains a separately labelled deterministic test-provider recording. It is checked by the normal test suite and supports an entirely offline CLI demonstration with `CANDOR_REPLAY_DIR=services/pipeline/tests/cassettes/synthetic`. It is not model-generated and is not a substitute for the blocked live Codex recording.
