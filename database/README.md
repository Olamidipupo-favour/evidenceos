# database/

Home of EvidenceOS's PostgreSQL schema and migration work.

## Status

Scaffolded only — the API is not wired to a database yet. This document records
the plan so the schema lands coherently when feature work starts.

## Planned schema (v0)

Domain entities for the product:

- **papers** — deduplicated publications harvested from PubMed/NCBI
  (`pmid` unique, title, abstract, authors, journal, publication year, DOI,
  citation count).
- **reviews** — an evidence review a user is building (title, question/PICO,
  status/state, timestamps).
- **review_papers** — join table attaching screened papers to a review
  (screening status, notes, evidence rating per outcome).
- **tags** — user/curated labels applied to papers and reviews.
- **evidence_matrix** projection — the structured matrix (review × outcome ×
  paper → rating/effect estimate) derived from `review_papers`, materialized
  for read-efficient delivery to humans and agents.

## Approach

- **ORM**: SQLAlchemy 2.x (typed, async-capable).
- **Migrations**: Alembic, versioned migration scripts under
  `backend/` (e.g. `backend/alembic/`).
- **Local Postgres** (no extra services committed):

```sh
docker run --name evidenceos-db -e POSTGRES_USER=evidenceos \
  -e POSTGRES_PASSWORD=evidenceos -e POSTGRES_DB=evidenceos \
  -p 5432:5432 -d postgres:16
```

Then set `DATABASE_URL` in `backend/.env`
(`postgresql+psycopg://evidenceos:evidenceos@localhost:5432/evidenceos`).

## Rule

No dummy fixtures or in-memory stand-ins masquerading as a database at runtime —
the code either talks to Postgres via the ORM or it stays unwired.