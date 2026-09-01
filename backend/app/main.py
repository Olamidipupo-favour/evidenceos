"""EvidenceOS API application factory and entrypoint."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import models  # noqa: F401  # registers all ORM models
from app.api.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.rate_limit import RateLimitMiddleware
from app.keepalive import keepalive_loop

settings = get_settings()
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(application: FastAPI):
    logger.info(
        "Starting %s (env=%s, rate_limit=%s/min)",
        settings.app_name,
        settings.app_env,
        settings.rate_limit_per_minute,
    )
    keepalive = asyncio.create_task(keepalive_loop())
    try:
        yield
    finally:
        keepalive.cancel()
        try:
            await keepalive
        except asyncio.CancelledError:
            pass
        logger.info("%s stopped", settings.app_name)


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    configure_logging()

    application = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_middleware(RateLimitMiddleware)
    application.include_router(api_router)

    @application.exception_handler(Exception)
    async def _internal_error(request: Request, exc: Exception) -> JSONResponse:
        """Return JSON 500s and log the traceback without leaking internals."""
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    return application


app = create_app()
