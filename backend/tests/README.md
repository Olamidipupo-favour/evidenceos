# tests

Shared pytest fixtures: a dedicated test database (`evidenceos_test`) is
created on the local PostgreSQL instance and the schema is rebuilt before
every test so each test starts from a clean state.

The test database URL is taken from `TEST_DATABASE_URL` (or defaults to the
local dev Postgres). `conftest.py` forces `DATABASE_URL` to the test URL before
the application is imported, so the FastAPI app talks to the test database.