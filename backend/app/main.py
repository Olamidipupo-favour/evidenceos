"""EvidenceOS API application factory and entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  # registers all ORM models
from app.api.router import api_router
from app.core.config import get_settings

settings = get_settings()


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    application = FastAPI(title=settings.app_name, version="0.1.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(api_router)
    return application


app = create_app()
