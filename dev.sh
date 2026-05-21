#!/usr/bin/env bash
# Run backend + frontend together for development.
# Usage: ./dev.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Backend
if [ ! -d "$ROOT/backend/.venv" ]; then
  echo "[setup] creating Python venv..."
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install --upgrade pip
  "$ROOT/backend/.venv/bin/pip" install -r "$ROOT/backend/requirements.txt"
fi
if [ ! -f "$ROOT/backend/.env" ]; then
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
  echo "[setup] created backend/.env — edit it to add ANTHROPIC_API_KEY"
fi

# Frontend
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "[setup] installing frontend deps..."
  (cd "$ROOT/frontend" && npm install)
fi

cleanup() { jobs -p | xargs -I{} kill {} 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --reload --port "${BACKEND_PORT:-8000}") &
BACKEND_PID=$!

(cd "$ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "  backend:  http://localhost:${BACKEND_PORT:-8000}/api/health"
echo "  frontend: http://localhost:3000"
echo ""
wait $BACKEND_PID $FRONTEND_PID
