from __future__ import annotations

import os
import subprocess
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from importlib import import_module
from pathlib import Path
from typing import TYPE_CHECKING, Literal
from uuid import uuid4

import modal

if TYPE_CHECKING:
    from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[2]
REMOTE = "/opt/candor"
app = modal.App("candor")
secrets = modal.Secret.from_name("candor-secrets")
data = modal.Volume.from_name("candor-data", create_if_missing=True)
identity_data = modal.Volume.from_name("candor-identity", create_if_missing=True)
eval_data = modal.Volume.from_name("candor-evals", create_if_missing=True)


def add_python_project(image: modal.Image, name: str) -> modal.Image:
    source = ROOT / "services" / name
    target = f"{REMOTE}/services/{name}"
    for filename in ("pyproject.toml", "uv.lock"):
        image = image.add_local_file(source / filename, f"{target}/{filename}", copy=True)
    return image.add_local_dir(
        source / "src", f"{target}/src", copy=True, ignore=["**/__pycache__/**", "**/*.pyc"]
    )


def python_image(name: str, base: modal.Image | None = None) -> modal.Image:
    image = base if base is not None else modal.Image.debian_slim(python_version="3.12")
    image = add_python_project(image.pip_install("uv==0.11.7"), "pipeline")
    if name != "pipeline":
        image = add_python_project(image, name)
    paths = [
        f"{REMOTE}/services/{name}/.venv/lib/python3.12/site-packages",
        f"{REMOTE}/services/{name}/src",
        f"{REMOTE}/services/pipeline/src",
    ]
    return (
        image.run_commands(f"uv sync --project {REMOTE}/services/{name} --frozen --no-dev")
        .env({"PYTHONPATH": ":".join(paths)})
        .workdir(REMOTE)
    )


def node_image() -> modal.Image:
    image = modal.Image.from_registry("node:22-bookworm-slim", add_python="3.12")
    for filename in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json"):
        image = image.add_local_file(ROOT / filename, f"{REMOTE}/{filename}", copy=True)
    for component in ("services/identity", "packages/privacy"):
        for filename in ("package.json", "tsconfig.json", "tsconfig.build.json"):
            image = image.add_local_file(
                ROOT / component / filename, f"{REMOTE}/{component}/{filename}", copy=True
            )
        image = image.add_local_dir(
            ROOT / component / "src", f"{REMOTE}/{component}/src", copy=True
        )
    return image.workdir(REMOTE).run_commands(
        "npm install --global pnpm@10.33.3",
        "pnpm install --frozen-lockfile --ignore-scripts",
        "pnpm --filter @candor/identity build",
        "pnpm --filter @candor/privacy build",
    )


api_image = python_image("api")
worker_image = python_image("pipeline")
identity_image = node_image()
eval_image = python_image("evals", identity_image).add_local_dir(
    ROOT / "services/evals/scenarios", f"{REMOTE}/services/evals/scenarios", copy=True
)


def service_environment(**overrides: str) -> dict[str, str]:
    return {**os.environ, **overrides}


def run_private(command: list[str], env: dict[str, str], timeout: int) -> None:
    result = subprocess.run(
        command,
        env=env,
        cwd=REMOTE,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=timeout,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"Service command failed with status {result.returncode}")


@app.function(
    image=api_image,
    secrets=[secrets],
    volumes={"/data": data},
    min_containers=1,
    max_containers=1,
    timeout=1800,
)
@modal.asgi_app()
def api() -> FastAPI:
    os.environ["CANDOR_DATA_DIR"] = "/data"
    os.environ["MODAL_ENABLED"] = "true"
    os.environ.pop("CANDOR_ENCLAVE_SK", None)
    application = import_module("candor_api.app").create_app()
    original_lifespan = application.router.lifespan_context

    @asynccontextmanager
    async def lifespan(instance: FastAPI) -> AsyncIterator[None]:
        try:
            async with original_lifespan(instance):
                yield
        finally:
            await data.commit.aio()

    application.router.lifespan_context = lifespan
    return application


@app.function(
    image=identity_image,
    secrets=[secrets],
    volumes={"/data": identity_data},
    min_containers=1,
    max_containers=1,
    timeout=1800,
)
@modal.web_server(8787, startup_timeout=60)
def identity() -> None:
    env = service_environment(CANDOR_DATA_DIR="/data", PORT="8787")
    env.pop("CANDOR_ENCLAVE_SK", None)
    subprocess.Popen(
        ["node", f"{REMOTE}/services/identity/dist/main.js"],
        cwd=REMOTE,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


@app.function(
    image=worker_image,
    secrets=[secrets],
    retries=modal.Retries(max_retries=2, backoff_coefficient=2.0),
    timeout=1800,
)
def run_analysis() -> None:
    if not os.environ.get("CANDOR_ENCLAVE_SK") or not os.environ.get("CANDOR_WORKER_TOKEN"):
        raise RuntimeError("Worker requires CANDOR_ENCLAVE_SK and CANDOR_WORKER_TOKEN")
    run_private(
        [f"{REMOTE}/services/pipeline/.venv/bin/candor-worker", "--once"],
        service_environment(),
        1740,
    )


@app.function(
    image=eval_image,
    secrets=[secrets],
    volumes={f"{REMOTE}/services/evals/results": eval_data},
    timeout=3600,
    max_containers=1,
)
def run_evals(provider: str = "meta") -> str:
    selected = (
        import_module("pydantic")
        .TypeAdapter(Literal["meta", "replay", "fireworks", "baseten", "codex"])
        .validate_python(provider)
    )
    run_id = str(uuid4())
    try:
        run_private(
            [
                f"{REMOTE}/services/evals/.venv/bin/candor-evals",
                "run",
                "--provider",
                selected,
                "--results-dir",
                f"{REMOTE}/services/evals/results/{run_id}",
                "--no-publish",
            ],
            service_environment(),
            3540,
        )
    finally:
        eval_data.commit()
    return run_id
