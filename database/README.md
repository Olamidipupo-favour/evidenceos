# database/

PostgreSQL persistence for EvidenceOS.

## Status

Implemented. The FastAPI backend connects to PostgreSQL via SQLAlchemy 2.x,
and schema changes are managed with Alembic migrations living in
[`backend/alembic`](../backend/alembic) (entrypoint `backend/alembic/env.py`).
Migrations run against the database in `DATABASE_URL`
(see `backend/.env.example`).

### Local Postgres

A single Postgres 16 container is the recommended local instance:

```sh
make -C backend db-up      # start (creates the container the first time)
make -C backend db-down    # stop & remove
```

or directly:

```sh
docker run --name evidenceos-db -e POSTGRES_USER=evidenceos \
  -e POSTGRES_PASSWORD=evidenceos -e POSTGRES_DB=evidenceos \
  -p 5432:5432 -d postgres:16
```

### Migrations

```sh
make -C backend migrate            # apply: alembic upgrade head
uv --directory backend run alembic revision --autogenerate -m "<message>"
```

## Schema

- **reviews** — `id` (uuid pk), `title`, `research_question`, `created_at`.
- **papers** — `id` (uuid pk), `pmid` (**unique**, indexed), `title`,
  `abstract`, `authors`, `journal`, `publication_date` (indexed), `doi`, `url`.
- **review_papers** — composite pk `(review_id, paper_id)`, `status`
  (`pending/screened/included/excluded`), `notes`, `created_at`; `review_id`
  and `paper_id` are both indexed; cascading deletes.
- **evidence_extractions** — `id` (uuid pk), `paper_id` (fk, indexed),
  `population`, `intervention`, `comparison`, `outcome`, `study_design`,
  `sample_size` (≥ 0), `key_finding`, `limitations`, `confidence`
  (`low/medium/high`), `created_at`.

All rows use client-side `uuid4` primary keys (no DB extensions needed).
The pytest suite runs against a dedicated `evidenceos_test` database whose
schema is rebuilt before every test.

## Rule

No dummy fixtures or in-memory stand-ins masquerading as a database at runtime —
the code talks to PostgreSQL via the ORM (or it stays unwired).