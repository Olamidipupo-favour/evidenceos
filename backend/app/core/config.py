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

    database_url: str = "postgresql+psycopg://evidenceos:evidenceos@localhost:5432/evidenceos"

    # PubMed/NCBI E-utilities. An email is required by NCBI policy; an API key
    # raises the permitted request rate (10 rps instead of 3 rps).
    ncbi_base_url: str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    pubmed_email: str | None = None
    pubmed_api_key: str | None = None

    # LLM-powered evidence extraction (Prompt 06). Optional — extraction stops
    # cleanly (HTTP 503) with a readable message when no provider is configured,
    # so researchers can still record extractions manually. The OpenAI-compatible
    # client never fabricates: it structures only the text already present in the
    # title/abstract and every result is re-validated against a Pydantic schema
    # before it can be persisted.
    llm_provider: str = "openai"  # "openai" | "mock" (mock is a deterministic developer seam)
    llm_api_key: str | None = None
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    llm_timeout: float = 60.0
    # Some OpenAI-compatible gateways reject requests unless a specific
    # User-Agent (client fingerprint) is sent. Empty by default.
    llm_user_agent: str | None = None


@lru_cache
def get_settings() -> Settings:
    """Return a cached settings instance so env files are read once."""
    return Settings()
