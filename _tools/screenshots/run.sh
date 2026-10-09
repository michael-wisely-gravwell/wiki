#!/bin/sh
# Take screenshots against a throwaway Gravwell. Arguments go to `playwright test`.
#
#   ./run.sh                          every shot
#   ./run.sh shots/gui.spec.ts        one file
#   ./run.sh -g menu                  shots whose image path matches "menu"
#   KEEP_GRAVWELL=1 ./run.sh ...      leave Gravwell up at http://localhost:18080
set -eu
cd "$(dirname "$0")"
export SHOTS_UID="$(id -u)" SHOTS_GID="$(id -g)"
status=0
docker compose run --rm shots "$@" || status=$?
[ -n "${KEEP_GRAVWELL:-}" ] || docker compose down
exit "$status"
