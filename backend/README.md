# EvidenceOS API

FastAPI backend for EvidenceOS.

## Stack

- FastAPI + Uvicorn
- SQLAlchemy 2.x (PostgreSQL via psycopg) + Alembic migrations
- pydantic-settings for configuration
- PubMed/NCBI E-utilities (esearch/efetch, rate-limited, results cached in PostgreSQL)

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

## Endpoints

```
GET    /health
GET    /api/search?q=&page=&page_size=       # PubMed search (results cached)
GET    /api/papers/{pmid}                    # PubMed lookup by PMID (cached)
GET    /reviews                              # list reviews
POST   /reviews                              # create a review
GET    /reviews/{id}                         # fetch a review
GET    /reviews/{id}/papers                  # list papers attached to a review
POST   /reviews/{id}/papers                  # attach a paper (with screening status)
GET    /papers                               # list papers
POST   /papers                               # create a paper (pmid unique)
GET    /papers/{id}                          # fetch a paper
GET    /papers/{id}/evidence-extractions     # list a paper's extractions
POST   /papers/{id}/evidence-extractions     # add structured evidence
```

Literature API behavior:

- `GET /api/search` runs NCBI `esearch` + `efetch`, normalizes records (title,
  abstract, authors list, journal, publication date, DOI, PubMed URL), and caches
  them in the `papers` table keyed by unique PMID — repeated requests never create
  duplicate rows. Empty queries return `422`.
- `GET /api/papers/{pmid}` serves the cached normalized paper when present,
  otherwise fetches it from PubMed. Invalid PMIDs return `422`; PMIDs absent from
  PubMed return `404`.
- External failures map to useful errors: rate limiting → `429`, network/HTTP
  errors → `502`, malformed NCBI payloads → `502`.
- NCBI E-utilities require an e-mail; set `PUBMED_EMAIL` (and optionally
  `PUBMED_API_KEY`, which raises the request limit from ~3/s to 10/s) in
  `backend/.env`. The default rate limiter is 0.34s between requests.

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