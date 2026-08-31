"""Basic per-client rate limiting for the public API.

A deliberately simple, dependency-free guard so a deployed instance cannot be
flooded. Requests to ``/api`` routes are counted in a 60-second fixed window
keyed by client IP; exceeding ``RATE_LIMIT_PER_MINUTE`` returns HTTP 429 with
a ``Retry-After`` header. Set ``RATE_LIMIT_PER_MINUTE=0`` to disable.

Behind Render's proxy the client IP arrives in ``X-Forwarded-For`` (uvicorn runs
with ``--proxy-headers``), which the key resolver prefers over the socket peer.
Limits are read from ``get_settings()`` at request time so tests can tune them
without rebuilding the app.
"""

import math
import threading
import time

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import get_settings

WINDOW_SECONDS = 60
_MAX_TRACKED_CLIENTS = 2048

_COUNTERS: dict[str, tuple[int, float]] = {}
_LOCK = threading.Lock()


def reset_rate_limits() -> None:
    """Clear all counters (used by tests to avoid cross-test pollution)."""
    with _LOCK:
        _COUNTERS.clear()


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"


class RateLimitMiddleware:
    """ASGI middleware enforcing a fixed-window limit on /api routes."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = get_settings().rate_limit_per_minute
        request = Request(scope)
        path = request.url.path

        if limit > 0 and path.startswith("/api") and path.rstrip("/") != "/health":
            if not self._record(request, limit):
                response = JSONResponse(
                    {"detail": ("Too many requests. Please slow down and try again in a moment.")},
                    status_code=429,
                    headers={"Retry-After": str(self._retry_after(request))},
                )
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)

    def _record(self, request: Request, limit: int) -> bool:
        """Return True when the request is allowed under ``limit``."""
        client = _client_key(request)
        now = time.monotonic()
        with _LOCK:
            hits, window_start = _COUNTERS.get(client, (0, now))
            if now - window_start >= WINDOW_SECONDS:
                hits, window_start = 0, now
            hits += 1
            if hits > limit:
                return False  # leave the counter untouched so it stays exceeded
            _COUNTERS[client] = (hits, window_start)
            if len(_COUNTERS) > _MAX_TRACKED_CLIENTS:
                _COUNTERS.clear()
            return True

    def _retry_after(self, request: Request) -> int:
        client = _client_key(request)
        now = time.monotonic()
        with _LOCK:
            _, window_start = _COUNTERS.get(client, (0, now))
        return max(1, int(math.ceil(WINDOW_SECONDS - (now - window_start))))
