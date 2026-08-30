# EvidenceOS API

FastAPI backend for EvidenceOS.

## Stack

- FastAPI + Uvicorn
- SQLAlchemy 2.x (PostgreSQL via psycopg) + Alembic migrations
- pydantic-settings for configuration
- PubMed/NCBI APIs (planned)

## Setup

The project uses [uv](https://docs.astral.sh/uv/) for Python/venv management.
PostgreSQL is required — start the local instance, then migrate and run:

```sh
uv sync
make db-up          # start local Postgres (docker)
make migrate        # apply Alembic migrations
uv run uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/health` → `{"status":"ok"}`

Configuration is read from environment variables or `backend/.env` (copy
`backend/.env.example` → `backend/.env`; `DATABASE_URL` must point at a
reachable PostgreSQL database).

## Endpoints (foundation)

```
GET    /health
POST   /reviews                      # create a review
GET    /reviews                      # list reviews
GET    /reviews/{id}                 # fetch a review
GET    /reviews/{id}/papers          # list papers attached to a review
POST   /reviews/{id}/papers          # attach a paper (with screening status)
POST   /papers                       # create a paper (pmid unique)
GET    /papers                       # list papers
GET    /papers/{id}                  # fetch a paper
POST   /papers/{id}/evidence-extractions   # add structured evidence
GET    /papers/{id}/evidence-extractions   # list a paper's extractions
```

Validation errors return `422` with field-level detail; missing resources return
`404`; duplicate PMIDs / repeated attachments return `409`.

Interactive docs: `http://localhost:8000/docs` (Swagger UI).

## Commands

```sh
make lint          # uv run ruff check .
make format        # uv run ruff format .
make test          # uv run pytest   (needs PostgreSQL running)
make db-up         # start Postgres container
make db-down       # remove Postgres container
make migrate       # alembic upgrade head
```