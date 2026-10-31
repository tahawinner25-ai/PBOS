#!/usr/bin/env bash
# Applies supabase/migrations to a throwaway local PostgreSQL cluster (with Supabase
# stubs) and runs the RLS / constraint tests. Needs PostgreSQL server binaries
# (initdb, pg_ctl, psql). It never touches a real Supabase project.
#
#   npm run test:rls
#   PBOS_PG_TMPROOT=/some/dir npm run test:rls   # where the temporary cluster is created
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Override to test a different set of migrations (for example the upgrade path).
MIGRATIONS_DIR="${PBOS_MIGRATIONS_DIR:-$ROOT/supabase/migrations}"

BIN=""
for d in /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql*/bin /usr/local/opt/postgresql*/bin; do
  [ -x "$d/initdb" ] && BIN="$d"
done
if [ -z "$BIN" ] && command -v initdb >/dev/null 2>&1; then BIN="$(dirname "$(command -v initdb)")"; fi
if [ -z "$BIN" ]; then
  echo "PostgreSQL server binaries (initdb, pg_ctl, psql) not found. Install PostgreSQL 14+ or run these SQL files against a scratch database manually." >&2
  exit 2
fi

AS=()
if [ "$(id -u)" = "0" ]; then AS=(runuser -u postgres --); fi

TMPROOT="${PBOS_PG_TMPROOT:-${TMPDIR:-/tmp}}"
WORK="$(mktemp -d "$TMPROOT/pbos-pg.XXXXXX")"
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; fi
PORT="${PBOS_PG_PORT:-54329}"

cleanup() {
  "${AS[@]}" "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${AS[@]}" "$BIN/initdb" -D "$WORK/data" -A trust -U postgres --no-sync >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$WORK/data" -l "$WORK/server.log" -w \
  -o "-c listen_addresses='' -c unix_socket_directories='$WORK' -c port=$PORT -c fsync=off" start >/dev/null

PSQL=("${AS[@]}" "$BIN/psql" -h "$WORK" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -d postgres -c "create database pbos_test" >/dev/null

echo "• stubs"
"${PSQL[@]}" -d pbos_test -f "$ROOT/supabase/tests/00_supabase_stubs.sql"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "• migration $(basename "$f")"
  "${PSQL[@]}" -d pbos_test -f "$f"
done
echo "• tests"
for t in "$ROOT"/supabase/tests/[1-9]*_*.test.sql; do
  echo "• $(basename "$t")"
  "${PSQL[@]}" -d pbos_test -f "$t" 2>&1
done
