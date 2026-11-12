#!/usr/bin/env bash
# Makes a full logical backup of the PBOS database (schema + data) into ./backups/.
# Needs the Postgres client tools (pg_dump 15+) and the DATABASE URL from
# Supabase > Project Settings > Database > Connection string (use the "Session pooler" URI).
#   SUPABASE_DB_URL='postgresql://postgres.xxxx:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres' ./scripts/backup-db.sh
# The backup contains your users' data and encrypted connection tokens: keep it private, never commit it.
set -euo pipefail
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL (see the comment at the top of this file)}"
mkdir -p backups
out="backups/pbos-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --schema=public --file "$out"
pg_restore --list "$out" >/dev/null   # proves the file is readable
echo "Backup written: $out ($(du -h "$out" | cut -f1))"
