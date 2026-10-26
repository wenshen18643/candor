# Evals handoff

Implemented six seeded, byte-reproducible scenarios with 48 evidence files and six ground-truth files. Each contains two emails, chat, memo, balanced CSV ledger, DOCX, PDF, and a first-person statement. All identities are fictional. Metadata canaries cover DOCX Author, LastModifiedBy and Company plus PDF Author and Creator. There are 36 truth events, two temporal contradictions, six contradictory accounts, and four planted instructions. Tests verify every truth quote against the actual extracted document text.

The harness implements all specified metric families: four-surface leakage, Hungarian matching, event recall, claim precision, grounding, citation precision, unsupported claims, Kendall tau-b, date MAE, interval coverage, temporal conflicts, chaos repair/degradation/validity, injection detection and paired event loss, contradictions, and follow-up gaps. JSON and Markdown reports contain scores and safe failure codes, never evidence or prompt bodies. Tap captures stay in memory.

The Node scrubber and pipeline are isolated behind adapters. The real scrubber CLI was exercised on all six scenarios. The real DAG, tap, record and replay providers were exercised with a deterministic schema fixture provider. Most tests use fake adapters and require no network or credentials. Stable synthetic report IDs and spotlight nonces make cassette lookup repeatable. Missing privacy CLI fails explicitly; there is no Python scrubber fallback.

`bench` measures extract, verify and gaps, computes p50/p95 latency, mean stage cost and Pareto membership, skips unavailable credentials, excludes incomplete providers from routing, and chooses the cheapest provider within 0.02 of the highest stage quality. JSON and Markdown reports and both web-summary writers are implemented and tested.

## Running

From the repository root, after the privacy owner has built `packages/privacy/dist/cli.js`:

```powershell
uv sync --project services/evals
uv run --project services/evals candor-evals synth
uv run --project services/evals candor-evals run --provider codex --scenarios all --samples 3 --record
uv run --project services/evals candor-evals run --provider replay --scenarios all
uv run --project services/evals candor-evals bench --providers codex:gpt-6.1-sol,meta:muse-spark-1.3 --repeats 3
uv run --project services/evals candor-evals health
```

Use the root `.env.example` variable names. `CANDOR_LLM_PROVIDER` supplies the CLI provider default; explicit `--provider` wins. Set `CANDOR_REPLAY_DIR=services/evals/cassettes` for shared cassette storage. Other provider credentials and model defaults are delegated to the pipeline registry. `--no-publish` suppresses the web-summary copy. Results otherwise go to `services/evals/results` and the two allowed `apps/web/public/data/*-latest.json` paths. No fake model-quality leaderboard was published.

The baseline is always fault-free. Every eval also runs chaos at 0.3 unless a nonzero `--chaos` value overrides it, and injected scenarios additionally run with their exact injected text removed.

## Validation

```powershell
uv run --project services/evals pytest services/evals/tests -q
uvx ruff@0.14.2 check services/evals
uvx ruff@0.14.2 format --check services/evals
python scripts/check_no_comments.py services
```

Final pytest summary: `55 passed in 43.94s`

Ruff check: `All checks passed!`

Ruff format: `24 files already formatted`

No-comments checker: passed across `services` (exit 0).

Real scrubber smoke: all six scenarios returned seven documents, zero direct reporter-identifier hits and zero stripped-metadata hits. The stricter partial-token payload counts were 7, 9, 5, 7, 6 and 5 in alphabetical scenario order (39 total); they remain visible to the metric.

All twelve binary fixtures were rendered and visually inspected, one page each. PDF rendering used PDFium. The packaged DOCX renderer lacked its runtime dependencies on this host; Microsoft Word export plus PDFium provided the final DOCX visual check. Generator determinism includes fixed ZIP entry timestamps and PDF creation dates.

This restricted Windows host denies access to directories Python creates with mode 0700. Test execution used an in-process, test-only `os.mkdir` wrapper that preserves inherited permissions, with temporary files under `.venv`. Production code retains normal private temporary-directory permissions. The project-local validation interpreter is `.venv/py312/Scripts/python`; uv caches and tools also remain under `.venv`.

Exact sandbox test command from the repository root:

```powershell
services/evals/.venv/py312/Scripts/python -c "import os,pytest; original=os.mkdir; os.mkdir=lambda path, mode=511, *, dir_fd=None: original(path, 511, dir_fd=dir_fd); raise SystemExit(pytest.main(['services/evals/tests','-q','--tb=short','--basetemp=services/evals/.venv/test-safe','-p','no:cacheprovider']))"
```

## Decisions and known limits

- The requested component write boundary overrides the spec's pipeline-router destination. Benchmark routing is written to `services/evals/router.json`; the pipeline owner must install that file into their component. No git state was changed; generated scenarios are present in the working tree.
- Benchmarks execute the public DAG and read stage-local timing/cost records. Extract quality is matched-event F1; verify quality is supported-verdict F1 against matched events; gaps quality is expected-type coverage. These are documented end-to-end quality proxies, not isolated stage replays with identical upstream state.
- Truly order-only truth events use `date: null` and `granularity: unknown`; they count toward event recall but not date-error denominators. Undefined rates and tau-b are JSON null. Missing predicted intervals reduce coverage rather than disappearing from its denominator.
- Leakage counts overlapping exact and token hits once per span, including conservative substrings of ordinary words. This can flag common team-name tokens; the actual scrubber's remaining counts are reported rather than hidden. Attack detection is deterministic quoted-marker matching and can count a warning that repeats an attack marker; no optional LLM judge was added.
- Live paid-provider quality, cost and latency have not been benchmarked in this session. Record a live run before replaying outside tests. No production cassettes or fabricated benchmark scores are supplied.

Implementation references: [SciPy tau-b](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.kendalltau.html) and [fpdf2 metadata](https://py-pdf.github.io/fpdf2/Metadata.html). Both integrations were verified by executable tests.
