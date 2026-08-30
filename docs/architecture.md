# EvidenceOS — architecture

## Overview

EvidenceOS is an **agent-native medical research workspace**. Humans and AI
agents work the same research surface: search biomedical literature, screen
papers, build evidence reviews, and inspect structured evidence matrices.
Agents interact with the *live application* through **WebMCP**-registered
tools rather than through a side-channel chatbot.

## Repo layout

```
.
├── frontend/   Next.js + React + TypeScript + Tailwind + shadcn/ui
├── backend/    FastAPI + Python (uv-managed venv)
├── webmcp/     @evidenceos/webmcp — tool contract types + schemas
├── database/   PostgreSQL schema/migration plan
├── docs/       architecture & WebMCP strategy
└── scripts/    setup/dev helpers
```

## Runtime components

```
┌─────────────────────────────┐     ┌───────────────────────────────┐
│  Browser tab                │     │  backend (FastAPI)            │
│                             │     │                               │
│  Next.js UI  ── fetch ────▶│────▶│  /api/search, /api/papers/{pmid},│
│  (humans)                  │     │  /api/reviews (CRUD + matrix)   │
│                             │     │  └─ PubMed/NCBI API ────────▶│ NCBI
│                             │     │  └─ PostgreSQL ─────────────▶│ DB
│  WebMCP tools               │     │     (SQLAlchemy + Alembic)   │
│  ─ registered via           │     └───────────────────────────────┘
│    document.modelContext    │
│  ─ called by in-page agent  │
└─────────────────────────────┘
```

- **Frontend** renders the human UI and, via `@evidenceos/webmcp`, registers
  tools that call the **same application logic** the UI calls. Agents act on
  the live page: search, screen, annotate, and assemble evidence matrices.
- **Backend** owns data access and domain logic: PubMed/NCBI retrieval and
  PostgreSQL persistence (SQLAlchemy 2.x, Alembic-migrated) served to both
  frontend and agents through one API contract.
- **webmcp** holds the shared types + JSON Schemas so tool contracts stay in
  sync between the browser registration layer and the API.

## Consistency rules

- One API is the single source of truth; WebMCP `execute` handlers proxy to it
  and never reimplement domain logic.
- Mutating agent actions require human confirmation
  (`requestUserInteraction`; `toolautosubmit` is read-only only).
- WebMCP layer is progressive enhancement: no API surface = normal human UI.

## Decisions (intentional)

- No microservices, no Redis, no Kubernetes — single FastAPI service plus the
  Next.js frontend, with Postgres arriving next.
- Health probe lives at `/health` and returns `{"status":"ok"}`.