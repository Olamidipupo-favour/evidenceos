"""Keep-alive for free Render web instances.

Free instances spin down after ~15 minutes without inbound traffic; the first
request after a spin-down pays a long cold start. This module gives the API a
small periodic self-ping so traffic keeps flowing and the instance stays warm:

- ``start_keepalive()`` is wired into the app lifespan (``app.main``) and, while
  the process is running, GETs the public health endpoint every
  ``KEEPALIVE_INTERVAL`` seconds.
- ``python -m app.keepalive`` performs a single ping — the same primitive a
  Render cron job (paid plan) would call on a schedule.

The target is ``KEEPALIVE_URL`` if set, otherwise ``RENDER_EXTERNAL_URL`` (Render
injects this on web services). With neither set, keep-alive is disabled.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
import urllib.error
import urllib.request

logger = logging.getLogger("app.keepalive")

DEFAULT_INTERVAL = 600  # seconds — comfortably inside Render's ~15 min idle window
HEALTH_PATH = "/health"


def target_url() -> str:
    """Return the public base URL to ping, or the empty string if unset."""
    return (os.environ.get("KEEPALIVE_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "").rstrip(
        "/"
    )


def ping(url: str, timeout: float = 60.0) -> tuple[int, float]:
    """GET ``url`` and return ``(status_code, elapsed_seconds)``."""
    started = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return int(response.status), time.monotonic() - started
    except urllib.error.URLError as exc:
        logger.warning("keepalive ping failed: %s", exc)
        return 0, time.monotonic() - started


async def keepalive_loop(interval: float | None = None) -> None:
    """Ping the public health endpoint until the task is cancelled."""
    base = target_url()
    if not base:
        logger.info("Keep-alive disabled (no KEEPALIVE_URL or RENDER_EXTERNAL_URL set).")
        return
    url = f"{base}{HEALTH_PATH}"
    if interval is None:
        interval = float(os.environ.get("KEEPALIVE_INTERVAL", DEFAULT_INTERVAL))
    logger.info("Keep-alive active: GET %s every %.0fs", url, float(interval))
    while True:
        status, elapsed = await asyncio.to_thread(ping, url)
        logger.info("Keep-alive GET %s -> %s in %.1fs", url, status, elapsed)
        await asyncio.sleep(float(interval))


def main() -> int:
    """Single-ping CLI (cron- or externally schedulable)."""
    base = target_url()
    if not base:
        print("keepalive: no target; set KEEPALIVE_URL or RENDER_EXTERNAL_URL", file=sys.stderr)
        return 1
    url = f"{base}{HEALTH_PATH}"
    status, elapsed = ping(url)
    print(f"keepalive: GET {url} -> {status} in {elapsed:.1f}s", flush=True)
    return 0 if status == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())