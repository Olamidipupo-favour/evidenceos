#!/usr/bin/env bash
# One-shot setup for the entire EvidenceOS monorepo.
# Requires: uv, Node.js >= 20, npm.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> backend (uv sync)"
(cd "$ROOT/backend" && uv sync)

echo "==> frontend (npm install)"
(cd "$ROOT/frontend" && npm install)

echo "==> webmcp (npm install)"
(cd "$ROOT/webmcp" && npm install)

echo "==> root tooling (concurrently, prettier)"
(cd "$ROOT" && npm install)

echo ""
echo "Setup complete. Run: npm run dev"