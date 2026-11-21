#!/usr/bin/env bash
# Runs the whole app locally: the API, the background worker (debriefs) and
# Expo for your phone. Ctrl+C stops all of it. Run scripts/dev-setup.sh once
# first (and again after pulls that change env files or migrations).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

get() { [ -f "$1" ] && { grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- | tr -d '\r'; } || true; }

if [ ! -f api/.env ] || [ ! -f apps/mobile/.env.local ]; then
  echo "Run scripts/dev-setup.sh first." >&2
  exit 1
fi

# Postgres and storage (no-op if already up).
(cd database && docker compose up -d postgres storage >/dev/null 2>&1) || {
  echo "Couldn't start Postgres/storage. Is Docker running?" >&2
  exit 1
}

# Stop the API and worker with this script, whichever way it ends.
trap 'trap - EXIT INT TERM; kill 0 2>/dev/null' EXIT INT TERM

tag() { while IFS= read -r line; do printf '%s %s\n' "$1" "$line"; done; }

(cd api && uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000 2>&1 | tag "[api]") &

if [ -n "$(get api/.env APP__OPENAI__API_KEY)" ]; then
  (cd api && uv run python -m worker 2>&1 | tag "[worker]") &
else
  echo "[worker] not started: add APP__OPENAI__API_KEY to api/.env (debriefs stay 'processing' without it)"
fi

sleep 2
cd apps/mobile
HOST=$(get .env.local REACT_NATIVE_PACKAGER_HOSTNAME)
echo "Scan the QR code with your phone's camera (Expo Go). API: $(get .env.local EXPO_PUBLIC_API_BASE_URL)"
REACT_NATIVE_PACKAGER_HOSTNAME="$HOST" npx expo start
