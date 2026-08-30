"""Application settings loaded from environment variables (and ``.env``)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application-wide settings.

    Values can be overridden through environment variables or a ``.env`` file
    placed in the ``backend/`` directory. See ``backend/.env.example``.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "EvidenceOS API"
    app_env: str = "development"

    # Comma-separated is not used here; pydantic-settings parses list[str] from
    # JSON, e.g. CORS_ORIGINS=["http://localhost:3000"]
    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    """Return a cached settings instance so env files are read once."""
    return Settings()
