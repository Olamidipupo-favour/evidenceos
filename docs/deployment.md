# Deployment guide

EvidenceOS ships as two deployables plus a managed database:

| Piece    | Provider | Artifact                                       |
| -------- | -------- | ---------------------------------------------- |
| API      | Render   | `render.yaml` blueprint + `backend/Dockerfile` |
| Database | Render   | managed PostgreSQL (in the same blueprint)     |
| Frontend | Vercel   | `vercel.json` (repo root)                      |

The API container regenerates everything on every boot:

```sh
alembic upgrade head        # apply migrations
python -m app.seed_demo     # provision the deterministic demo review (idempotent)
uvicorn app.main:app ...    # serve, with --proxy-headers for real client IPs
```

So a fresh deploy is immediately demo-ready and re-runs are safe — nothing depends
on a human hitting endpoints to "repair" the data.

---

## 1. Deploy the API + database on Render

1. Push this repository (it can be private) to GitHub/GitLab.
2. Render dashboard → **New +** → **Blueprint**.
3. Select this repo. Render reads `render.yaml`, which provisions:
   - `evidenceos-db` — managed PostgreSQL (free plan).
   - `evidenceos-api` — Docker web service, health checks on `/health/ready`.
4. After the first deploy, open the blueprint and set the **secrets** (they are
   declared with `sync: false`, so the initial values are placeholders):
   - `CORS_ORIGINS` → JSON array with the deployed frontend origin, e.g.
     `["https://evidenceos.vercel.app"]`. **Required** — the frontend calls the
     API cross-origin and credentials are matched exactly.
   - `PUBMED_EMAIL` → a contact email (required by NCBI policy for E-utilities).
   - `LLM_API_KEY` (optional) → enables live `extract_evidence` for the WebMCP
     workflow. Without it, that step returns HTTP 503 with a readable message,
     and the seeded demo extractions remain unaffected.
   - `PUBMED_API_KEY` (optional) → higher NCBI rate limits.
5. Trigger **Manual deploy → Latest commit** and wait for the deploy to finish.

Verify:

```sh
BASE=https://<your-api>.onrender.com
curl -s  $BASE/health         # {"status":"ok"}
curl -s  $BASE/health/ready   # {"status":"ok","database":"ok"}
curl -s  $BASE/api/reviews    # list — contains the seeded "Metformin in diabetes — evidence review"
curl -s  $BASE/api/reviews/00000000-0000-4000-8000-00000000d001/matrix
```

Notes:

- The Docker image runs migrations and the seed automatically; you never run
  `alembic` by hand against the managed DB.
- Render's **free** Postgres expires after 30 days. For a judging window use a
  Starter database or renew before it lapses.
- Rate limiting (`RATE_LIMIT_PER_MINUTE`, default `120`) and request logging are
  already configured; `APP_ENV=production` disables the `mock` LLM provider.

## 2. Deploy the frontend on Vercel

1. Vercel → **Add New… → Project** → import this repo.
2. It detects root `vercel.json`: framework **Next.js**, root directory
   `frontend`, installs the whole monorepo, and builds `@evidenceos/webmcp`
   before `next build`.
3. Set build-time environment variable:
   - `NEXT_PUBLIC_API_URL` → your deployed Render URL, e.g.
     `https://<your-api>.onrender.com`
     (it is inlined at build time, so set it **before** the build.)
4. Deploy.

Verify:

```sh
FRONT=https://<your-frontend>.vercel.app
curl -sI $FRONT | grep -i cross-origin-opener-policy   # COOP: same-origin
open $FRONT
```

The deployed page is HTTPS (secure context) and sends
`Cross-Origin-Opener-Policy: same-origin`, which together opt the page into an
origin-keyed agent cluster — the precondition for WebMCP.

---

## 3. Local equivalents

```sh
make -C backend db-up        # local Postgres
make -C backend migrate      # alembic upgrade head
make -C backend db-seed      # python -m app.seed_demo       (idempotent)
make -C backend db-seed-reset# python -m app.seed_demo --reset
```

If a demo run ever leaves local data messy, a full rebuild is:

```sh
docker rm -f evidenceos-db && make -C backend db-up
make -C backend migrate && make -C backend db-seed
```

## 4. Judging walkthrough

```sh
BASE=… your Render API …
FRONT=… your Vercel URL …
```

1. **Open the review** → `FRONT` shows the seeded
   _"Metformin in diabetes — evidence review"_ (2 public papers, both `included`).
2. **Evidence matrix** → open the review; both rows display structured PICO
   evidence (population, intervention, comparison, outcome, sample size, key
   finding), labeled `manual` (deterministic, present even without an LLM key).
3. **Agent actions** → header button. This is where **WebMCP** is demonstrated:
   - In a **WebMCP-capable browser** (Chromium 146+ with the origin trial or
     `#enable-webmcp-testing`), the panel shows _8 tools registered_, lists them,
     and offers **Run agent**, which starts the LLM-driven orchestrator: the
     planner reasons aloud (thoughts stream into the feed), then chooses each
     tool call itself against the open review — search → fetch → create/activate
     a review when needed → attach papers → extract → build the matrix → compare
     → clean up — driving the real API (visible in the live call feed).
   - Otherwise the panel explains _"WebMCP unavailable"_ and why (no browser
     support), while the rest of the app is fully usable.
4. **Why WebMCP** → open the collapsible _"Why WebMCP powers this interaction"_
   note in the panel; the longer explanation lives in [webmcp.md](webmcp.md).
5. **Repeatability** → each API boot reseeds deterministically; a total reset is
   `make -C backend db-seed-reset` locally or redeploying on Render.

### Verification one-liners

```sh
curl -s  $BASE/health/ready                  # readiness incl. DB
curl -s  $BASE/api/reviews | grep Metformin  # seeded review present
# rate limiting responds 429 after the limit:
for i in {1..125}; do curl -s -o /dev/null $BASE/api/reviews; done; curl -s $BASE/api/reviews
```
