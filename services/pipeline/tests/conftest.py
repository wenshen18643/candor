import shutil
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest


@pytest.fixture(autouse=True)
def local_temp(monkeypatch: pytest.MonkeyPatch) -> None:
    directory = Path(__file__).parents[1] / ".tmp"
    directory.mkdir(exist_ok=True)
    monkeypatch.setenv("TMP", str(directory))
    monkeypatch.setenv("TEMP", str(directory))


@pytest.fixture
def tmp_path() -> Iterator[Path]:
    root = Path(__file__).parents[1].resolve() / ".tmp"
    directory = root / ("test-" + uuid4().hex)
    directory.mkdir(parents=True)
    yield directory
    if directory.resolve().parent == root.resolve():
        shutil.rmtree(directory)
