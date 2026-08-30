#!/usr/bin/env bash
# Run backend + frontend together for local development.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec npm run dev --prefix "$ROOT"