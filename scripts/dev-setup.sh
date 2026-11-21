#!/usr/bin/env bash
# Local setup for running Hacksgiving on your own machine and phone.
# Safe to run again any time (after a pull, say): it only ever ADDS settings
# that are missing or still placeholders, never overwrites yours.
#
#   scripts/dev-setup.sh          then   scripts/dev.sh
#
# What it does:
#   1. env files: database/.env, api/.env, apps/mobile/.env.local (from the
#      examples if missing), with your Tailscale (or LAN) IP for the phone
#   2. Postgres and the local storage container (Docker)
#   3. migrations + the dev user
#   4. Python and Node dependencies
#   5. tells you what's still missing (your OpenAI key, an Auth0 callback)
#
# Override the IP your phone uses: HACKSGIVING_DEV_IP=192.168.1.20 scripts/dev-setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing $1. $2" >&2; exit 1; }; }

# KEY's value in an env file ("" when absent).
get() { [ -f "$1" ] && { grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- | tr -d '\r'; } || true; }

# Replace KEY's line, keeping every other line as it is.
replace() {
  awk -v k="$2" -v v="$3" 'index($0, k "=") == 1 { print k "=" v; next } { print }' "$1" >"$1.tmp" && mv "$1.tmp" "$1"
}

# Set KEY when it's missing, empty, or one of the placeholder values given after it.
ensure() {
  local file=$1 key=$2 value=$3 current
  shift 3
  if ! grep -qE "^$key=" "$file"; then
    printf '%s=%s\n' "$key" "$value" >>"$file"
    ok "$file: added $key"
    return
  fi
  current=$(get "$file" "$key")
  for placeholder in "" "$@"; do
    if [ "$current" = "$placeholder" ]; then
      replace "$file" "$key" "$value"
      ok "$file: set $key"
      return
    fi
  done
}

detect_ip() {
  if [ -n "${HACKSGIVING_DEV_IP:-}" ]; then echo "$HACKSGIVING_DEV_IP"; return; fi
  # Tailscale first: the team's Auth0 callbacks are registered per Tailscale IP.
  local t ip
  for t in tailscale "/c/Program Files/Tailscale/tailscale.exe" "/Applications/Tailscale.app/Contents/MacOS/Tailscale"; do
    if command -v "$t" >/dev/null 2>&1 || [ -x "$t" ]; then
      ip=$("$t" ip -4 2>/dev/null | head -1 | tr -d '\r' || true)
      if [ -n "$ip" ]; then echo "$ip"; return; fi
    fi
  done
  case "$(uname -s)" in
    Darwin) ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true ;;
    Linux) hostname -I 2>/dev/null | awk '{print $1}' ;;
    *) ipconfig 2>/dev/null | tr -d '\r' | grep -E "IPv4" | sed -E 's/.*: *//' | grep -vE '^(172\.|169\.254\.)' | head -1 ;;
  esac
}

step "Checking tools"
need docker "Install Docker Desktop (or Docker Engine) and start it."
need uv "Install uv: https://docs.astral.sh/uv/getting-started/installation/"
need npm "Install Node 22: https://nodejs.org"
docker info >/dev/null 2>&1 || { echo "Docker isn't running; start Docker Desktop and try again." >&2; exit 1; }
ok "docker, uv, node"

IP=$(detect_ip)
if [ -z "$IP" ]; then
  echo "Couldn't work out this machine's IP. Run again with HACKSGIVING_DEV_IP=<your IP>." >&2
  exit 1
fi
ok "your phone will reach this machine at $IP"

step "Env files"
[ -f database/.env ] || { cp database/.env.example database/.env; ok "created database/.env"; }
[ -f api/.env ] || { cp api/example.env api/.env; ok "created api/.env"; }
[ -f apps/mobile/.env.local ] || { cp apps/mobile/.env.example apps/mobile/.env.local; ok "created apps/mobile/.env.local"; }

# Local storage (voice debriefs): the container's keys, and the API's matching ones.
ensure database/.env STORAGE_PORT 8333
ensure database/.env STORAGE_ACCESS_KEY hacksgiving-local-storage change-me
ensure database/.env STORAGE_SECRET_KEY hacksgiving-local-storage-secret change-me-too
STORAGE_KEY=$(get database/.env STORAGE_ACCESS_KEY)
STORAGE_SECRET=$(get database/.env STORAGE_SECRET_KEY)

ensure api/.env APP__STORAGE__BACKEND s3
ensure api/.env APP__STORAGE__ENDPOINT_URL "http://localhost:8333"
ensure api/.env APP__STORAGE__PUBLIC_ENDPOINT_URL "http://$IP:8333" "http://<this-machine's-ip>:8333"
ensure api/.env APP__STORAGE__ACCESS_KEY_ID "$STORAGE_KEY"
ensure api/.env APP__STORAGE__SECRET_ACCESS_KEY "$STORAGE_SECRET"
ensure api/.env APP__STORAGE__BUCKET phantom-audio
ensure api/.env APP__STORAGE__CREATE_BUCKET true
if [ "$(get api/.env APP__STORAGE__ACCESS_KEY_ID)" != "$STORAGE_KEY" ]; then
  warn "api/.env APP__STORAGE__ACCESS_KEY_ID doesn't match database/.env STORAGE_ACCESS_KEY; voice uploads will fail until they do"
fi
if [ "$(get api/.env APP__STORAGE__PUBLIC_ENDPOINT_URL)" != "http://$IP:8333" ]; then
  warn "api/.env APP__STORAGE__PUBLIC_ENDPOINT_URL is $(get api/.env APP__STORAGE__PUBLIC_ENDPOINT_URL), not http://$IP:8333 (fine if that's on purpose)"
fi

# The phone app: the API at this machine's IP, and the team's Auth0 dev tenant.
ensure apps/mobile/.env.local EXPO_PUBLIC_API_BASE_URL "http://$IP:8000/v1" "http://localhost:8000/v1"
ensure apps/mobile/.env.local REACT_NATIVE_PACKAGER_HOSTNAME "$IP"
ensure apps/mobile/.env.local EXPO_PUBLIC_AUTH0_DOMAIN dev-3wpn13zh30l6orpi.us.auth0.com
ensure apps/mobile/.env.local EXPO_PUBLIC_AUTH0_CLIENT_ID U218lvdCzEBESk0teqWgIIBqiTXL9Exo
ensure apps/mobile/.env.local EXPO_PUBLIC_AUTH0_AUDIENCE https://api.hacksgiving.app

step "Postgres and storage"
(cd database && docker compose up -d postgres storage)
printf '  waiting for Postgres'
for _ in $(seq 1 60); do
  if docker exec hacksgiving-postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then break; fi
  printf '.'
  sleep 1
done
echo
ok "Postgres and storage are up (storage on :8333)"

step "Python dependencies and migrations"
(cd api && uv sync --quiet)
(cd database && ./migrate.sh --local)
ok "database is at $(cd database && ./migrate.sh current 2>/dev/null | tail -1)"

step "Node dependencies"
(cd apps/mobile && npm ci --no-audit --no-fund --loglevel=error)
ok "mobile dependencies installed"

step "Still to do"
todo=0
if [ -z "$(get api/.env APP__OPENAI__API_KEY)" ]; then
  warn "Add your OpenAI key to api/.env: APP__OPENAI__API_KEY=sk-...  (debriefs and the routing suggestion need it)"
  todo=1
fi
CALLBACK="exp://$IP:8081/--/auth"
if ! grep -q "$CALLBACK" auth0/terraform/variables.tf 2>/dev/null; then
  warn "Sign-in from your phone needs $CALLBACK in auth0/terraform/variables.tf (dev_callback_urls), applied by CI"
  todo=1
fi
[ "$todo" -eq 0 ] && ok "nothing; you're set"

printf '\nStart everything (API, worker, Expo):  scripts/dev.sh\n'
