#!/usr/bin/env bash
# ============================================================================
# OwBrand database + RLS test harness
# ============================================================================
# Boots a throwaway PostgreSQL cluster, applies the Supabase compatibility shim
# followed by schema.sql and every migration in order, then runs the RLS test
# suite. Proves two things that cannot be asserted from application code alone:
#
#   1. The migration chain applies cleanly to a FRESH database, in the order a
#      real deployment would run it.
#   2. Row Level Security actually isolates tenants — user A cannot read user
#      B's rows even when querying directly.
#
# Usage:  supabase/test/run-db-tests.sh
# Requires: PostgreSQL server binaries (Debian/Ubuntu: postgresql-16).
# ============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGROOT="${PGROOT:-/var/tmp/owbrand-pgtest}"
PGDATA="$PGROOT/data"
PGSOCK="$PGROOT/sock"
PGUSER_OS="${PGUSER_OS:-pgtest}"
DB=owbrand_test

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$PGROOT/sql"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

if [ ! -x "$PGBIN/initdb" ]; then
  red "PostgreSQL server binaries not found at $PGBIN"
  echo "Install them (Ubuntu: apt-get install -y postgresql-16) or set PGBIN."
  exit 127
fi

# A server must not run as root, so use an unprivileged account.
if ! id "$PGUSER_OS" >/dev/null 2>&1; then
  useradd -m "$PGUSER_OS"
fi

cleanup() {
  su "$PGUSER_OS" -c "$PGBIN/pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Preparing cluster at $PGROOT"
rm -rf "$PGROOT"
mkdir -p "$PGDATA" "$PGSOCK" "$WORK"
chown -R "$PGUSER_OS" "$PGROOT"
chmod 755 "$PGROOT"

su "$PGUSER_OS" -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8" >/dev/null
su "$PGUSER_OS" -c "$PGBIN/pg_ctl -D $PGDATA -o '-k $PGSOCK -c listen_addresses=' -l $PGDATA/server.log start -w" >/dev/null

# Copy SQL somewhere the unprivileged account can read.
cp -r "$REPO_ROOT/supabase/." "$WORK/"
chown -R "$PGUSER_OS" "$WORK"

psql_run() { su "$PGUSER_OS" -c "$PGBIN/psql -h $PGSOCK -U postgres -d ${2:-$DB} -v ON_ERROR_STOP=1 -q -f $1"; }
psql_cmd() { su "$PGUSER_OS" -c "$PGBIN/psql -h $PGSOCK -U postgres -d ${2:-postgres} -tAc \"$1\""; }

psql_cmd "drop database if exists $DB" postgres >/dev/null
psql_cmd "create database $DB" postgres >/dev/null

echo "==> Applying shim + schema + migrations"
FAILED=0
apply() {
  local file="$1"
  if out=$(psql_run "$file" 2>&1); then
    printf '    ok   %s\n' "$(basename "$file")"
  else
    printf '    FAIL %s\n' "$(basename "$file")"
    echo "$out" | grep -E 'ERROR|DETAIL|CONTEXT' | head -5 | sed 's/^/         /'
    FAILED=1
  fi
}

apply "$WORK/test/supabase-shim.sql"
apply "$WORK/schema.sql"
for f in "$WORK"/migrations/*.sql; do apply "$f"; done

if [ "$FAILED" -ne 0 ]; then
  red "==> Migration chain FAILED"
  exit 1
fi
green "==> Migration chain applied cleanly"

# Match a hosted Supabase project, which grants table privileges to anon /
# authenticated / service_role on everything in the public schema. Without this
# an isolation test could pass because of a missing GRANT rather than because
# RLS did its job.
psql_cmd "select public.grant_supabase_roles()" "$DB" >/dev/null

echo "==> Running RLS / tenant-isolation tests"
set +e
su "$PGUSER_OS" -c "$PGBIN/psql -h $PGSOCK -U postgres -d $DB -v ON_ERROR_STOP=1 -f $WORK/test/rls-tests.sql" \
  >"$PGROOT/rls-output.txt" 2>&1
PSQL_STATUS=$?
set -e

grep -E '^(PASS|FAIL|SUMMARY)' "$PGROOT/rls-output.txt" || true

# Three independent failure signals, because any one of them alone can be
# fooled: psql's exit status (catches a SQL error that aborted the run before
# any assertion executed), an explicit FAIL line, and the presence of a SUMMARY
# line (catches a run that died silently part-way through).
if [ "$PSQL_STATUS" -ne 0 ]; then
  red "==> RLS tests FAILED (psql exit $PSQL_STATUS)"
  grep -E 'ERROR|DETAIL|LINE' "$PGROOT/rls-output.txt" | head -10 | sed 's/^/    /'
  exit 1
fi

if grep -q '^FAIL' "$PGROOT/rls-output.txt"; then
  red "==> RLS tests FAILED"
  grep '^FAIL' "$PGROOT/rls-output.txt" | sed 's/^/    /'
  exit 1
fi

if ! grep -q '^SUMMARY' "$PGROOT/rls-output.txt"; then
  red "==> RLS tests did not complete (no SUMMARY line produced)"
  tail -20 "$PGROOT/rls-output.txt" | sed 's/^/    /'
  exit 1
fi

green "==> All database tests passed"
