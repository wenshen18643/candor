from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import tempfile
from pathlib import Path
from typing import Protocol
from uuid import UUID

from pydantic import ValidationError

from candor_evals.models import GroundTruth, Scrubbed


class PrivacyError(RuntimeError):
    pass


class PrivacyAdapter(Protocol):
    async def scrub(self, directory: Path, truth: GroundTruth) -> Scrubbed: ...


class NodePrivacyAdapter:
    def __init__(self, root: Path, timeout: float = 120.0) -> None:
        self.root = root.resolve()
        self.cli = self.root / "packages/privacy/dist/cli.js"
        self.timeout = timeout

    async def scrub(self, directory: Path, truth: GroundTruth) -> Scrubbed:
        node = shutil.which("node")
        if node is None or not self.cli.is_file():
            raise PrivacyError(
                "Privacy CLI unavailable; build packages/privacy before running evals"
            )
        with tempfile.TemporaryDirectory(prefix="candor-evals-scrub-") as temporary:
            output = Path(temporary) / "scrubbed.json"
            process = await asyncio.create_subprocess_exec(
                node,
                str(self.cli),
                "scrub",
                "--dir",
                str(directory.resolve()),
                "--self-terms",
                json.dumps(truth.self_identifiers),
                "--out",
                str(output),
                cwd=self.root,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                await asyncio.wait_for(process.wait(), timeout=self.timeout)
            except (TimeoutError, asyncio.CancelledError):
                if process.returncode is None:
                    process.kill()
                await process.wait()
                raise
            if process.returncode != 0:
                raise PrivacyError(f"Privacy CLI failed with exit status {process.returncode}")
            try:
                scrubbed = Scrubbed.model_validate_json(output.read_bytes())
                scrubbed.payload.report_id = str(
                    UUID(bytes=hashlib.sha256(truth.scenario_id.encode()).digest()[:16], version=4)
                )
                return scrubbed
            except (OSError, ValidationError):
                raise PrivacyError("Privacy CLI returned missing or invalid output") from None
