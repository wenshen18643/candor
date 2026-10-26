# Modal Python SDK — verified 2026-10-26

## Versions and validation

- PyPI latest: **`modal==1.6.2`**; installed and imported on Windows/Python 3.13.7 in a disposable `%TEMP%` environment.
- Supporting versions actually installed: **`fastapi==0.162.0`**, **`httpx==0.28.1`**, **`uvicorn==0.54.0`**.
- Ran the app pattern below locally: `worker.local("local-test")` returned `{"job_id":"local-test","done":true}`; `TestClient(api.local()).get("/health")` returned `{"ok":true}`. `Function.from_name(...)` constructed a lazy `Function` handle.
- Inspected SDK signatures and ran `python -m modal --version`: `modal client version: 1.6.2`. No cloud deployment, image build, authenticated spawn, or GPU execution was performed; those require a Modal account/token.

```powershell
python -m pip install "modal==1.6.2" "fastapi==0.162.0"
python -m modal setup  # interactive local account setup; omit in CI
```

Sources: [PyPI metadata](https://pypi.org/pypi/modal/json), [release notes](https://modal.com/docs/reference/changelog), [SDK source](https://github.com/modal-labs/modal-client).

## Minimal app: FastAPI plus separately scheduled worker

Save as `modal_app.py` in the implementation project. The file itself is included automatically; additional local modules need explicit image inclusion.

```python
import modal

app = modal.App("candor")
image = modal.Image.debian_slim(python_version="3.13").uv_pip_install(
    "fastapi==0.162.0"
)

@app.function(
    image=image, cpu=1.0, memory=512, timeout=300,
    retries=modal.Retries(max_retries=2, initial_delay=1.0),
)
def worker(job_id: str) -> dict:
    # Replace with idempotent processing of an opaque job reference.
    return {"job_id": job_id, "done": True}

@app.function(image=image, cpu=0.5, memory=512, timeout=60)
@modal.asgi_app()
def api():
    from fastapi import FastAPI
    web = FastAPI()

    @web.get("/health")
    def health():
        return {"ok": True}

    @web.post("/jobs", status_code=202)
    async def enqueue(job_id: str):  # query parameter in this minimal example
        call = await worker.spawn.aio(job_id)
        return {"call_id": call.object_id}

    return web
```

`@app.function` is outermost; `@modal.asgi_app()` decorates a factory returning the ASGI application, not an HTTP handler. `.spawn.aio()` submits a separate Modal invocation and returns without waiting for the work. Do not substitute a FastAPI in-process background task when the job must outlive the HTTP request. The example endpoint is public; add application authentication before exposing sensitive operations. [Web Functions](https://modal.com/docs/guide/webhooks), [invocation methods](https://modal.com/docs/guide/function-calling).

```powershell
python -m modal serve modal_app.py   # temporary app, live reload, terminal stays open
python -m modal deploy modal_app.py  # durable named deployment; prints HTTPS URL
```

`serve` is for development. A function lookup by app name works for a deployed app, not a temporary `serve` app. [Deployment guide](https://modal.com/docs/guide/managing-deployments), [function lookups](https://modal.com/docs/guide/trigger-deployed-functions).

## Image builds and local project directories

Verified public signatures, with optional parameters omitted where irrelevant:

```python
Image.uv_pip_install(self, *packages, requirements=None, extra_options="", ...)
Image.pip_install(self, *packages, extra_options="", ...)
Image.uv_sync(self, uv_project_dir="./", *, groups=None, extras=None,
              frozen=True, extra_options="", uv_version=None, ...)
Image.add_local_python_source(self, *modules, copy=False, ignore=NON_PYTHON_FILES)
Image.add_local_dir(self, local_path, remote_path, *, copy=False, ignore=[])
```

The ellipses above denote abbreviated signatures, not runnable arguments. Concrete recipes:

```python
# Dependency installation from the local project's pyproject.toml + uv.lock:
locked = modal.Image.debian_slim(python_version="3.13").uv_sync(
    uv_project_dir="./backend"
).add_local_python_source("candor_backend")

# Install a local Python project itself, including package metadata:
packaged = (
    modal.Image.debian_slim(python_version="3.13")
    .add_local_dir("./backend", "/opt/backend", copy=True,
                   ignore=[".venv/**", ".git/**", "__pycache__/**"])
    .uv_pip_install("/opt/backend")
)
# .pip_install("/opt/backend") is the pip alternative.

# Source/data needed only at runtime:
runtime = image.add_local_python_source("candor_backend").add_local_dir(
    "./assets", "/assets"
)
```

- `uv_sync` synchronizes dependencies; it does not replace explicitly including your application source. The named module must be importable in the deploying process.
- `copy=False` adds local files at container startup, avoiding image rebuilds. Use `copy=True` when later build commands need those files. Subsequent build steps after a runtime-only source addition are not allowed.
- `add_local_python_source` defaults to Python files only, placed under `/root`; use `add_local_dir` or an explicit `ignore` override for data files.
- Package strings passed to pip/uv are interpreted inside the Linux image, not against the host filesystem. Copy local project files first. Do not include `.env`, private keys, or a host `.venv` in images.
- `uv_sync` defaults to `frozen=True`; maintain the lockfile. Pin package and uv versions when repeatable builds matter.

Sources: [image guide](https://modal.com/docs/guide/images), [Image reference](https://modal.com/docs/reference/modal.Image), [1.0 migration](https://modal.com/docs/guide/modal-1-0-migration).

## Secrets and Volumes

```python
secret = modal.Secret.from_name("candor-runtime", required_keys=["MODEL_API_KEY"])
volume = modal.Volume.from_name("candor-results", create_if_missing=True)

@app.function(image=image, secrets=[secret], volumes={"/results": volume})
def save_result(job_id: str, encrypted_result: bytes):
    import os
    from pathlib import Path
    from uuid import UUID
    name = str(UUID(job_id))  # constrain filenames
    assert os.environ["MODEL_API_KEY"]
    Path(f"/results/{name}.bin").write_bytes(encrypted_result)
    volume.commit()  # publish this container's writes
```

Create the named Secret through the dashboard or `modal secret create candor-runtime --from-dotenv .env`. Secret values become environment variables only in functions given that Secret. `Secret.from_dict({...})` and `Secret.from_dotenv(...)` also exist; never commit literal credentials. [Secrets](https://modal.com/docs/guide/secrets).

Volumes persist across invocations. For existing mounted containers, `volume.reload()` refreshes committed changes from other containers; close open files before reloading. Avoid concurrent writes to the same file and use distinct job paths. A Volume is storage, not a queue or transactional database. [Volumes](https://modal.com/docs/guide/volumes).

## Calling from another Python process

```python
import modal
f = modal.Function.from_name("candor", "worker", environment_name="main")
call = f.spawn("opaque-job-id")
print(call.object_id)
result = call.get(timeout=60)  # optional wait, not part of submission
# Async equivalents: await f.spawn.aio(...); await call.get.aio(timeout=60)
```

Verified signatures: `Function.from_name(app_name, name, *, version=None, environment_name=None, client=None)` and `Function.spawn(self, *args, **kwargs) -> FunctionCall`. Lookup is lazy; constructing the handle alone does not verify that the deployment exists. Supply the actual environment name or omit it to use the configured environment. [Lookup reference](https://modal.com/docs/guide/trigger-deployed-functions).

## Node HTTP process

```python
node_image = modal.Image.from_registry("node:22-bookworm-slim", add_python="3.13")

@app.function(image=node_image, timeout=300)
@modal.web_server(8000, startup_timeout=30)
def node_api():
    import subprocess
    subprocess.Popen([
        "node", "-e",
        "require('http').createServer((q,s)=>{"
        "s.setHeader('content-type','application/json');"
        "s.end(JSON.stringify({ok:true}));}).listen(8000,'0.0.0.0')",
    ])
```

For an existing Node service, copy its directory with `add_local_dir(..., copy=True)`, run `npm ci` during the image build, then `Popen(["node", "server.js"], cwd="/app")`. The process must bind `0.0.0.0`, not loopback. The decorated function launches the process and returns; do not block with `subprocess.run`. `web_server(port, *, startup_timeout=5.0, label=None, custom_domains=None, requires_proxy_auth=False)` is verified. [Web servers](https://modal.com/docs/guide/webhooks#non-asgi-web-servers).

## Resources, retries, timeouts, CI

- `@app.function(cpu=2.0, memory=4096, gpu="L4", timeout=900)` requests CPU cores, memory in MiB, and a GPU. Omit `gpu` for CPU-only execution. GPU counts use strings such as `"H100:2"`; current availability is workspace/region dependent.
- `cpu` also accepts `(reservation, limit)`; `memory` accepts `(reservation, limit)`. `min_containers`, `max_containers`, and `scaledown_window` control capacity and warm-container retention.
- `timeout` defaults to 300 seconds in 1.6.2. It is an execution limit, separate from `startup_timeout` and the HTTP gateway's request limit. Submit long jobs and return a call/job ID.
- `retries=2` or `modal.Retries(max_retries=2, backoff_coefficient=2.0, initial_delay=1.0, max_delay=60.0)` retries failing function inputs. Make side effects idempotent; retries do not provide exactly-once execution.
- CI must inject **`MODAL_TOKEN_ID`** and **`MODAL_TOKEN_SECRET`** as secret environment variables before `modal deploy`. No `modal setup` is needed. Prefer a scoped service-user token. `MODAL_ENVIRONMENT` can select the deployment environment.

```yaml
# Fragment inside an existing GitHub Actions job:
- run: python -m pip install modal==1.6.2
- run: python -m modal deploy modal_app.py
  env:
    MODAL_TOKEN_ID: ${{ secrets.MODAL_TOKEN_ID }}
    MODAL_TOKEN_SECRET: ${{ secrets.MODAL_TOKEN_SECRET }}
```

Sources: [CPU/memory](https://modal.com/docs/guide/resources), [GPUs](https://modal.com/docs/guide/gpu), [retries](https://modal.com/docs/guide/retries), [timeouts](https://modal.com/docs/guide/timeouts), [CI deployment](https://modal.com/docs/guide/continuous-deployment).
