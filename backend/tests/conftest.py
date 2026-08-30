"""Shared test fixtures backed by a dedicated PostgreSQL database.

``DATABASE_URL`` is pointed at ``evidenceos_test`` before any application
module is imported so the FastAPI app (engine/session) uses the test database.
"""

# ruff: noqa: E402  # imports below must follow the DATABASE_URL override

import os

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://evidenceos:evidenceos@localhost:5432/evidenceos_test",
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.main import app


def _admin_engine():
    """A connection to the maintenance DB for CREATE/DROP DATABASE."""
    admin_url = TEST_DATABASE_URL.rsplit("/", 1)[0] + "/postgres"
    return create_engine(admin_url, isolation_level="AUTOCOMMIT")


def _create_test_database() -> None:
    with _admin_engine().connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = 'evidenceos_test'")
        ).scalar()
        if not exists:
            conn.execute(text("CREATE DATABASE evidenceos_test"))


_create_test_database()


@pytest.fixture()
def reset_schema():
    """Drop and recreate all tables against the test database."""
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def db_session(reset_schema):
    """Fresh ORM session on an empty test schema."""
    testing_factory = sessionmaker(bind=reset_schema, autoflush=False, expire_on_commit=False)
    session = testing_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(reset_schema):
    """TestClient backed by the clean test schema."""
    with TestClient(app) as test_client:
        yield test_client
