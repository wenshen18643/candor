# Privacy handoff

Implemented every public API in spec 07 and the Node CLI. PDF Info/XMP objects and IDs are removed; DOCX properties, custom metadata, thumbnails, revision authors/initials/dates and ZIP metadata are sanitized. EML tracing headers and attachments are removed, retained headers are decoded for PII detection, and HTML-only mail becomes text. Browser images use EXIF inspection and canvas re-encoding. Text fingerprints are removed before hashing.

Detection covers the specified regex families, checksum validation, compromise NER, custom terms and reporter variants. Scrubbing consistently links people and email families across documents, respects decisions, and always redacts self matches. Leakage assessment and the payload builder emit the Python contract's snake_case shape without original filenames or pseudonym-map values.

Run from the repository root:

```text
pnpm --filter @candor/privacy build
pnpm --filter @candor/privacy test
pnpm --filter @candor/privacy typecheck
pnpm exec eslint packages/crypto packages/privacy
pnpm exec prettier --check packages/crypto packages/privacy
node packages/privacy/dist/cli.js scrub --dir <scenario> --self-terms <json-array-or-path> --out <new-file>
```

Final test summary:

```text
Test Files  3 passed (3)
     Tests  20 passed (20)
```

Tests reparse sanitized PDF/DOCX/EML bytes, check encoded email headers and HTML, PII precision, linking, forced self redaction, leakage and payload shape. The built CLI runs on temporary fixtures with no stdout and refuses overwrites. Real EXIF parsing is tested with deterministic canvas doubles. All six existing synthetic evaluation scenarios additionally passed the CLI with no reporter canaries remaining, and their payloads validated against the actual Python `AnalysisPayload`. Build, typechecking, ESLint and Prettier pass.

Integration choices and deviations:

- Supply scrub document keys as file names, with a separate statement key. Original file-index keys `D1`, `D2`, etc. are also accepted. Output IDs are contiguous after image/unsupported exclusions. Titles are generic to prevent filename leakage; IP/DOB legend types map to Python's `other`.
- CLI defaults to a random report UUID and campaign `evaluation`; self-term files inside the scenario are excluded. Its explicit output includes the sensitive pseudonym map required for evaluation and must be handled accordingly. Library processing uses memory only and no network integration or environment settings.
- Build uses the root TypeScript compiler's ESM emitter instead of tsup because this sandbox rejects esbuild child-process launches. The runnable entry remains `dist/cli.js`. Vitest uses threads; CLI tests run the built entry in Node workers.
- Resource limits: 25 MiB input, 100 MiB expanded DOCX, 10,000 ZIP entries and 40 million image pixels.

Known limits: PII detection is English-oriented and heuristic; contextual identification can remain. Metadata stripping does not redact visible document content, embedded files or all application-specific structures. No OCR is provided. Node images and unsupported files explicitly report remaining metadata and are excluded from analysis. Browser bundles compile, but actual Chromium execution could not complete in this sandbox; Node tests ran on 24.15.0, not separately on Node 22.

Automatic approval review rejected recursive cleanup of the temporary, ignored `dist/browser-profile` directory as blocked by policy. The empty-task browser profile remains; temporary scenario output files were removed.
