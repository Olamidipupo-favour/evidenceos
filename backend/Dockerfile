# EvidenceOS API image — built by Render (see render.yaml).
#
# Build context is the repo root (Render default), so paths below are relative
# to that root. Ordering mirrors `uv sync --frozen` for the production lockfile.
#
# On boot the container runs, in order:
#   alembic upgrade head   -> build the schema
#   python -m app.seed_demo -> provision deterministic demo data (idempotent)
#   uvicorn                  -> serve the API (port from $PORT)
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# uv is only used at build time; runtime deps land in /app/backend/.venv.
RUN pip install --no-cache-dir uv

WORKDIR /app/backend

COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

COPY backend/app ./app
COPY backend/alembic.ini .
COPY backend/alembic ./alembic

EXPOSE 8000

CMD ["bash", "-lc", \
  "alembic upgrade head && python -m app.seed_demo && exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8000}\" --proxy-headers --forwarded-allow-ips=\"*\""]