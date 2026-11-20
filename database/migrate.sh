#!/usr/bin/env bash
set -euo pipefail

# Runs Alembic migrations with the api/ project's Python environment.
#
#   ./migrate.sh                 upgrade to the latest revision
#   ./migrate.sh --local         upgrade, then load seeds/local (the dev user)
#   ./migrate.sh <alembic args>  anything else, e.g. `current`, `history`, `downgrade -1`
#
# Connection settings come from the environment, or from database/.env when
# HACKSGIVING_MIGRATION_DATABASE_URL isn't already set (see .env.example).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

if [ -z "${HACKSGIVING_MIGRATION_DATABASE_URL:-}" ] && [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${HACKSGIVING_MIGRATION_DATABASE_URL:-}" ]; then
  echo "Set HACKSGIVING_MIGRATION_DATABASE_URL (or copy .env.example to .env)" >&2
  exit 1
fi

alembic() {
  uv run --project ../api alembic "$@"
}

if [ "$#" -eq 0 ]; then
  alembic upgrade head
elif [ "$1" = "--local" ]; then
  alembic upgrade head
  uv run --project ../api python seeds/load.py seeds/local
else
  alembic "$@"
fi
