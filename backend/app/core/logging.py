"""Centralized logging configuration.

Production deployments log at INFO to stdout (captured by Render); development
runs get DEBUG. ``force=True`` replaces the default root handlers so uvicorn's
access/error logs propagate through the same format instead of doubling up.
"""

import logging
import sys

from app.core.config import get_settings


def configure_logging() -> None:
    settings = get_settings()
    logging.basicConfig(
        level=logging.DEBUG if settings.app_env == "development" else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,
    )
