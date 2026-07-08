#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
VITE_API_BASE="${VITE_API_BASE:-http://${BACKEND_HOST}:${BACKEND_PORT}/api}"

BACKEND_PID=""
FRONTEND_PID=""

find_python() {
  if [[ -n "${PYTHON:-}" ]]; then
    printf '%s\n' "$PYTHON"
    return
  fi

  if [[ -x "$BACKEND_DIR/.venv/Scripts/python.exe" ]]; then
    printf '%s\n' "$BACKEND_DIR/.venv/Scripts/python.exe"
    return
  fi

  if [[ -x "$BACKEND_DIR/.venv/bin/python" ]]; then
    printf '%s\n' "$BACKEND_DIR/.venv/bin/python"
    return
  fi

  if command -v python >/dev/null 2>&1; then
    command -v python
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return
  fi

  echo "Python was not found. Create backend/.venv or set PYTHON=/path/to/python." >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 was not found in PATH." >&2
    exit 1
  fi
}

cleanup() {
  echo
  echo "Stopping VSCode4Education Repository dev services..."

  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}

PYTHON_BIN="$(find_python)"
require_command npm

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Frontend dependencies are missing. Run this first:"
  echo "  cd \"$FRONTEND_DIR\" && npm install"
  exit 1
fi

echo "Using Python: $PYTHON_BIN"
echo "Backend:  http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "Frontend: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "API base: $VITE_API_BASE"
echo

(
  cd "$BACKEND_DIR"
  "$PYTHON_BIN" manage.py migrate
  exec "$PYTHON_BIN" manage.py runserver "${BACKEND_HOST}:${BACKEND_PORT}"
) &
BACKEND_PID=$!

(
  cd "$FRONTEND_DIR"
  export VITE_API_BASE
  exec npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

trap cleanup EXIT INT TERM

echo "Both services are starting. Press Ctrl+C to stop them."

while true; do
  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    wait "$BACKEND_PID" || true
    echo "Backend process stopped."
    exit 1
  fi

  if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    wait "$FRONTEND_PID" || true
    echo "Frontend process stopped."
    exit 1
  fi

  sleep 1
done
