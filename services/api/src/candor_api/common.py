import base64
import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4


def now() -> datetime:
    return datetime.now(UTC)


def stamp(value: datetime | None = None) -> str:
    return (value or now()).isoformat(timespec="microseconds").replace("+00:00", "Z")


def bucket() -> str:
    return now().replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:00:00Z")


def uid() -> str:
    return str(uuid4())


def b64u(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def unb64(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("Invalid base64url")
    decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    if b64u(decoded) != value:
        raise ValueError("Noncanonical base64url")
    return decoded


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def key_id(value: bytes) -> str:
    return hashlib.blake2b(value, digest_size=16).hexdigest()


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        self.status = status
        self.code = code
        self.message = message
        super().__init__(code)


def require(condition: object, status: int, code: str, message: str) -> None:
    if not condition:
        raise ApiError(status, code, message)
