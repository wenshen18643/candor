# Candor on Modal

Run commands from the repository root with the existing API environment, which includes Modal.
The deployment defines one app, `candor`, and four functions: `api`, `identity`, `run_analysis`,
and `run_evals`. No cloud calls or credential reads are required merely to import the module.

## One-time setup

Authenticate in your own terminal:

```sh
uv run --project services/api modal token new
```

Prepare a private `.env` using the names in the root `.env.example`. Set public HTTPS
`CANDOR_API_URL`, `CANDOR_IDENTITY_URL`, and `CANDOR_WEB_URL`; configure independent identity,
worker, JWT and payments secrets. The worker's `CANDOR_ENCLAVE_SK` must correspond to the
public enclave key distributed by the seeded API. Use `CANDOR_LLM_PROVIDER=meta` and a
`MODEL_API_KEY` for hosted analysis, `CANDOR_LLM_PROVIDER=claude` with `ANTHROPIC_API_KEY`, or
configure Fireworks/Baseten. The images do not contain an authenticated Codex or Claude Code CLI. Never upload local credential directories or evidence files.

```sh
uv run --project services/api modal secret create candor-secrets --from-dotenv .env
uv run --project services/api modal deploy infra/modal/app.py
```

The equivalent deployment command with Modal on PATH is `modal deploy infra/modal/app.py`.
On the first deployment, use the printed endpoint URLs to update the secret and redeploy.
Configure Vercel's `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_IDENTITY_URL` with those endpoints.
Leaving the web API URL empty selects showcase mode.

Deployment does not seed or reset a database. Provision demo campaigns/reviewers with the API
owner's `candor-api seed --reset` command against the mounted data directory, then securely
configure the matching enclave key in `candor-secrets`. Perform this before accepting reports;
resetting a running deployment would invalidate its stored credentials and audit state.

## Storage and invocation

- `api` uses the actual `candor_api.app:create_app` factory. It mounts `candor-data` at `/data`,
  enables Modal dispatch, removes the enclave secret from its environment, and commits after
  closing the ASGI lifespan. API concurrency is limited to one container for SQLite safety.
- `identity` runs built JavaScript with Node 22 on port 8787. Its separate `candor-identity`
  volume persists issuer keys, sessions and nullifiers. It also uses one container.
- `run_analysis()` takes no arguments, matching `ModalLauncher.spawn()` in the API. It runs
  `candor-worker --once` with a 1,740-second subprocess limit, a 1,800-second Modal timeout,
  and two retries with exponential backoff. It has no evidence-storage volume.
- `run_evals(provider="meta")` is manual so deployment cannot accidentally incur scheduled
  inference costs. Each invocation writes a unique run directory on `candor-evals`, mounted
  at `/opt/candor/services/evals/results` to satisfy the eval CLI's output restriction.
  It disables web publication and commits metrics even when the command fails.

```sh
uv run --project services/api modal run infra/modal/app.py::run_evals --provider meta
```

The real worker and eval provider registries support deterministic `replay` via
`CANDOR_LLM_PROVIDER`/`--provider` and `CANDOR_REPLAY_DIR`. Supply cassettes matching the exact
synthetic payloads; the deployment never substitutes invented results for absent recordings.
For eval replay, upload cassettes under the eval volume and set `CANDOR_REPLAY_DIR` to their
mounted path beneath `/opt/candor/services/evals/results`.

Images copy only explicit manifests, lockfiles, source trees and synthetic eval scenarios.
Python installs use frozen uv locks; the Node image builds identity and the privacy CLI using
the frozen pnpm lock. Host `.env` files, runtime databases, `.venv`, and `node_modules` are
never copied into an image. No package installation is needed to construct the app locally;
image dependency installation happens only when Modal builds the image remotely.

SQLite on Modal Volumes is the hackathon storage choice, not a multi-writer database design.
Volume background commits can lose the most recent writes on abrupt container failure.
The API additionally accepts three distinct PostgreSQL URLs through its existing settings:
`CANDOR_REPORTS_DB_URL`, `CANDOR_AUDIT_DB_URL`, and `CANDOR_PAYMENTS_DB_URL`.
Those API-supported names are not yet present in the canonical `.env.example`; this component
does not edit that file. Identity currently remains SQLite.

Worker analysis failures are reported to the API by the worker itself and may return exit zero;
Modal retries cover subprocess failures, not every failed analysis. The API queue remains the
authority for job status and leases. Cloud image builds, deployment, persistence across remote
restarts and authenticated inference require separate validation with a configured account.

References: [Modal images](https://modal.com/docs/guide/images),
[Volumes](https://modal.com/docs/guide/volumes),
[Secrets](https://modal.com/docs/guide/secrets), and
[function invocation](https://modal.com/docs/guide/function-calling).
