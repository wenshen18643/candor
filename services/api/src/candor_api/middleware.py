import json
import logging
import threading
import time
from typing import Any

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("candor.api")


class TokenBuckets:
    def __init__(self, capacity: int = 120, refill: float = 2.0) -> None:
        self.capacity = capacity
        self.refill = refill
        self.entries: dict[str, tuple[float, float]] = {}
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        current = time.monotonic()
        with self.lock:
            if len(self.entries) >= 10000:
                self.entries = {
                    ip: entry for ip, entry in self.entries.items() if current - entry[1] < 60
                }
                if len(self.entries) >= 10000 and key not in self.entries:
                    return False
            amount, previous = self.entries.get(key, (float(self.capacity), current))
            amount = min(self.capacity, amount + (current - previous) * self.refill)
            allowed = amount >= 1
            self.entries[key] = (amount - 1 if allowed else amount, current)
            return allowed


class GuardMiddleware:
    def __init__(self, app: ASGIApp, buckets: TokenBuckets) -> None:
        self.app = app
        self.buckets = buckets

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        if path.startswith("/v1/") and not self.buckets.allow(
            (scope.get("client") or ("unknown",))[0]
        ):
            await self.reject(scope, receive, send, 429, "rate_limited", "Request limit exceeded")
            return
        limit = 40 * 1024 * 1024 if path in {"/v1/reports", "/v1/chaff"} else 4 * 1024 * 1024
        length = dict(scope["headers"]).get(b"content-length")
        if length:
            try:
                too_large = int(length) > limit or int(length) < 0
            except ValueError:
                too_large = True
            if too_large:
                await self.reject(
                    scope, receive, send, 413, "body_too_large", "Request body exceeds limit"
                )
                return
        size = 0
        buffered: list[Message] = []
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > limit:
                await self.reject(
                    scope, receive, send, 413, "body_too_large", "Request body exceeds limit"
                )
                return
            buffered.append(message)
            if not message.get("more_body", False):
                break
        iterator = iter(buffered)

        async def replay() -> Message:
            return next(iterator, None) or await receive()

        async def safe_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                route = scope.get("route")
                logger.info(
                    json.dumps(
                        {
                            "event": "http",
                            "method": scope["method"],
                            "route": getattr(route, "path", "unmatched"),
                            "status": message["status"],
                        },
                        separators=(",", ":"),
                    )
                )
            await send(message)

        await self.app(scope, replay, safe_send)

    async def reject(
        self, scope: Scope, receive: Receive, send: Send, status: int, code: str, message: str
    ) -> None:
        response = JSONResponse(
            {"error": {"code": code, "message": message}},
            status_code=status,
            headers={"Retry-After": "1"} if status == 429 else None,
        )
        await response(scope, receive, send)


class SafeFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        if record.name == "candor.api":
            return record.getMessage()
        return json.dumps({"event": "server", "level": record.levelname})


def logging_config() -> dict[str, Any]:
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"safe": {"()": SafeFormatter}},
        "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "safe"}},
        "root": {"level": "WARNING", "handlers": ["console"]},
        "loggers": {
            "candor.api": {"level": "INFO", "handlers": ["console"], "propagate": False},
            "uvicorn.access": {"level": "CRITICAL", "handlers": [], "propagate": False},
            "uvicorn.error": {"level": "INFO", "handlers": ["console"], "propagate": False},
        },
    }
