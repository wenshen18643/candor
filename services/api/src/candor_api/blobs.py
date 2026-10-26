import hashlib
import os
import re
import tempfile
from pathlib import Path
from typing import Protocol


class BlobStore(Protocol):
    def put(self, value: bytes) -> str: ...

    def get(self, reference: str) -> bytes: ...


class LocalBlobStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def path(self, reference: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{64}", reference):
            raise ValueError("Invalid blob reference")
        return self.root / reference[:2] / reference

    def put(self, value: bytes) -> str:
        reference = hashlib.sha256(value).hexdigest()
        destination = self.path(reference)
        destination.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=destination.parent)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(value)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, destination)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return reference

    def get(self, reference: str) -> bytes:
        value = self.path(reference).read_bytes()
        if hashlib.sha256(value).hexdigest() != reference:
            raise ValueError("Blob integrity failure")
        return value
