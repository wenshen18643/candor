# 06 · Infrastructure, local orchestration and CI

## Local development

- `pnpm install` at the root installs all TS workspaces.
- Each Python service: `uv sync --project services/<name>`.
- `pnpm dev` runs `scripts/dev.mjs`, which loads `.env` / `data/demo/.env.local`, then starts with
  prefixed, coloured output: identity (`pnpm --filter @candor/identity dev`), API (`uv run --project
  services/api candor-api serve --reload`), worker (`uv run --project services/pipeline
  candor-worker`) and web (`pnpm --filter @candor/web dev`). Ctrl+C stops all children (Windows
  safe: use `tree-kill` or `taskkill /T`).
- `pnpm seed` runs `candor-api seed --reset` then `pnpm --filter @candor/sdk seed:demo`, which
  submits two complete reports through the real client libraries (mock Self, mock x402) and runs
  their analysis with the replay provider so the reviewer console has content immediately.

## Modal (`infra/modal/app.py`)

One Modal app named `candor`:
- `api`: `@modal.asgi_app()` serving `candor_api.main:app`, SQLite on a `modal.Volume` mounted at
  `/data` (acceptable for the hackathon; Postgres URL supported via secret).
- `identity`: `@modal.web_server(8787)` running the built identity service with Node 22 in the
  image.
- `run_analysis`: `@app.function(retries=modal.Retries(max_retries=2, backoff_coefficient=2.0),
  timeout=1800)` that runs `candor-worker --once` against the API URL. Spawned by the API on enqueue.
- `run_evals`: scheduled/manual function running `candor-evals run --provider meta` and writing
  results to the volume.
Secrets: `candor-secrets` with all env vars from `.env.example`. Deployment command:
`modal deploy infra/modal/app.py`. Document the one-time `modal token new` step in the README.

## Web deployment

`apps/web` deploys to Vercel. Its only server-side config is public URLs
(`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_IDENTITY_URL`). When no backend URL is configured the web app
runs in "showcase" mode with recorded demo data so the public URL always works.

## CI (`.github/workflows/ci.yml`)

Jobs: `js` (pnpm install, format check, eslint incl. no-comments, typecheck, vitest), `python`
(matrix over api, pipeline, evals: uv sync, ruff check, ruff format --check, comment checker,
pytest with replay provider), `e2e` (build, seed, start services, Playwright happy path). Node 22,
Python 3.12, uv.
