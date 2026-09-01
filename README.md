# EvidenceOS

**Agent-native medical research workspace.** Search biomedical literature,
screen papers, and assemble structured evidence reviews — side by side with AI
agents that operate the _live application_ through WebMCP-registered tools
(not a bolted-on chatbot).

Built for the **WebMCP Challenge**. Human-first UI; agents work the same
artifacts via structured browser tools.

## Stack

| Layer    | Tech                                                      |
| -------- | --------------------------------------------------------- |
| Frontend | Next.js · TypeScript · React · Tailwind CSS · shadcn/ui   |
| Backend  | FastAPI · SQLAlchemy 2.x · Alembic · Python 3.14          |
| Data     | PostgreSQL                                                |
| Sources  | PubMed / NCBI E-utilities (esearch/efetch)                |
| Agents   | WebMCP (`document.modelContext`) via `@evidenceos/webmcp` |

## Repo layout

```
├── frontend/   Next.js app (UI) — port 3000
├── backend/    FastAPI service — port 8000
├── webmcp/     WebMCP tool contract types + JSON Schemas
├── database/   PostgreSQL schema + Alembic migration entrypoint
├── docs/       architecture.md · webmcp.md · deployment.md
├── scripts/    setup.sh · dev.sh
├── render.yaml Render blueprint (API + managed Postgres)
└── vercel.json Frontend deployment config (Vercel)
```

## Prerequisites

- **Node.js ≥ 20** and npm
- **uv** (Python package/venv manager) — https://docs.astral.sh/uv
- Python 3.14 (or the 3.x of your choice via `backend/.python-version`)

## Quickstart

```sh
# 1. Install everything
./scripts/setup.sh

# 2. Copy environment examples (edit as needed)
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# 3. Run frontend + backend together
npm run dev
```

Verify:

```sh
curl http://localhost:8000/health   # → {"status":"ok"}
open http://localhost:3000          # frontend UI
```

Run a single side:

```sh
npm run dev:backend   # FastAPI on :8000 (uvicorn --reload)
npm run dev:frontend  # Next.js on :3000
```

## Environment variables

| Var                     | Where                 | Default                     | Purpose                               |
| ----------------------- | --------------------- | --------------------------- | ------------------------------------- |
| `APP_NAME`              | `backend/.env`        | `EvidenceOS API`            | API display name                      |
| `APP_ENV`               | `backend/.env`        | `development`               | Runtime environment                   |
| `CORS_ORIGINS`          | `backend/.env`        | `["http://localhost:3000"]` | JSON list of allowed origins          |
| `DATABASE_URL`          | `backend/.env`        | local dev Postgres          | SQLAlchemy URL for the app database   |
| `RATE_LIMIT_PER_MINUTE` | `backend/.env`        | `120`                       | Per-IP limit for `/api`; `0` disables |
| `NEXT_PUBLIC_API_URL`   | `frontend/.env.local` | `http://localhost:8000`     | Backend base URL for the frontend     |

The database must be running before the API starts
(`make -C backend db-up`). Placeholder config for the upcoming pieces
(PUBMED ids) is documented in the examples. **Never commit real secrets —
`.env*` files are git-ignored.**

A deterministic demo review (2 public papers with curated evidence) can be
seeded at any time — this is what a deployed instance provisions on boot:

```sh
make -C backend db-seed        # idempotent upsert
make -C backend db-seed-reset  # tear down + recreate
```

## Commands

From the repo root:

```sh
npm run lint          # ESLint (frontend) + ruff (backend)
npm run typecheck     # tsc for frontend + webmcp
npm run format        # Prettier + ruff format
npm run format:check  # verify formatting
npm run test          # vitest (frontend) + pytest (backend)
npm run build         # next build + webmcp build
```

Equivalents inside each app: `backend/Makefile` (`make lint test dev`),
`frontend/package.json`, `webmcp/package.json`.

## WebMCP

See [docs/webmcp.md](docs/webmcp.md) for the strategy and
[webmcp/schemas](webmcp/schemas) for tool contracts. Key rules:

- Agents use the eight registered tools (`search_literature`, `get_paper`,
  `create_review`, `add_paper_to_review`, `remove_paper_from_review`,
  `extract_evidence`, `get_evidence_matrix`, `compare_papers`); `execute`
  handlers call the same backend API the UI uses.
- Every execution is mirrored into the **Agent actions** panel (header button):
  registration status, registered tools, and a live call feed with inputs,
  outputs, and errors, plus a _Run agent_ button that starts the LLM-driven
  orchestrator. The planner reasons aloud — its thoughts stream into the feed
  token by token — and decides each tool call itself over real WebMCP.
  Tool executions also stream into the header **Activity** panel in real time.
- Read-only tools set `annotations.readOnlyHint: true`; mutations are annotated
  `false` and remain visible/auditable in the human UI.
- Progressive enhancement: no WebMCP browser support → plain human UI.

## Deployment

The stack deploys to **Render** (API + managed Postgres, via `render.yaml`) and
**Vercel** (frontend, via `vercel.json`). The API runs migrations and seeds the
deterministic demo review on every boot, so a fresh deploy is immediately
demo-ready. See **[docs/deployment.md](docs/deployment.md)** for exact steps,
the env vars you must set, and the judging walkthrough.

## License

[MIT](LICENSE)
