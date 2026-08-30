# EvidenceOS API

FastAPI backend for EvidenceOS.

## Stack

- FastAPI + Uvicorn
- pydantic-settings for configuration
- PostgreSQL (planned — see `../database/`)
- PubMed/NCBI APIs (planned)

## Setup

The project uses [uv](https://docs.astral.sh/uv/) for Python/venv management.

```sh
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/health` → `{"status":"ok"}`

Configuration is read from environment variables or `backend/.env`.
Copy `backend/.env.example` to `backend/.env` if you need to override anything.

## Commands

```sh
uv run ruff check .        # lint
uv run ruff format .       # format
uv run pytest              # tests
```