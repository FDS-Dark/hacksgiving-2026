#!/usr/bin/env bash
# Run a command as one app variant: exports apps/mobile/.env.<variant> (shell
# values beat every .env file Expo loads), then runs the command.
#
#   scripts/variant.sh staging npx expo prebuild --platform ios --clean
#   scripts/variant.sh staging xcodebuild ...
#   scripts/variant.sh production npx expo prebuild --platform ios --clean
#
# Switching variants changes the bundle id and URL scheme, so always
# prebuild with --clean after a switch.
set -euo pipefail

variant="${1:?usage: scripts/variant.sh <production|staging> <command...>}"
shift
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
file="$here/.env.$variant"
[ -f "$file" ] || { echo "No $file" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$file"
set +a
export APP_VARIANT="$variant"

exec "$@"
