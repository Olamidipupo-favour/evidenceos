#!/usr/bin/env bash
set -euo pipefail

# Runtime deps live in the uv-built venv; use it explicitly so this never
# depends on the container runtime's PATH/ENV handling (avoids the earlier
# "alembic: command not found" boot failures).
export PATH="/app/backend/.venv/bin:$PATH"

echo "[boot] applying schema migrations..."
alembic upgrade head

echo "[boot] seeding demo data..."
python -m app.seed_demo

echo "[boot] API ready, listening on port ${PORT:-8000}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="*"