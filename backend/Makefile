# EvidenceOS API convenience targets (via uv)

.PHONY: install dev lint format format-check test db-up db-down migrate db-seed db-seed-reset

install:
	uv sync

dev:
	uv run uvicorn app.main:app --reload --port 8000

lint:
	uv run ruff check .

format:
	uv run ruff format .

format-check:
	uv run ruff format . --check

test:
	uv run pytest

db-up:
	@if docker ps -a --format '{{.Names}}' | grep -qx 'evidenceos-db'; then \
		docker start evidenceos-db; \
	else \
		docker run --name evidenceos-db \
			-e POSTGRES_USER=evidenceos -e POSTGRES_PASSWORD=evidenceos \
			-e POSTGRES_DB=evidenceos -p 5432:5432 -d postgres:16; \
	fi

db-down:
	docker rm -f evidenceos-db

migrate:
	uv run alembic upgrade head

# Deterministic demo data (see app/seed_demo.py). Idempotent; safe to run
# repeatedly. --reset tears the demo rows down and recreates them.
db-seed:
	uv run python -m app.seed_demo

db-seed-reset:
	uv run python -m app.seed_demo --reset