# EvidenceOS API convenience targets (via uv)

.PHONY: install dev lint format format-check test

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