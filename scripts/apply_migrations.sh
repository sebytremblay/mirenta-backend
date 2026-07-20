#!/usr/bin/env bash
#
# Apply pending Supabase SQL migrations in order, tracked by a ledger.
#
# The backend on Render auto-deploys application code from main, but the
# hand-written SQL migrations in supabase/migrations/ were applied by hand
# through the Supabase SQL editor. That gap is how the deployed schema drifted
# behind the code (a `signals` insert with a signal_type the enum did not yet
# have failed in production). This script closes the loop: CI runs it on every
# push to main so the schema tracks the code the same way the app does.
#
# Model: a ledger table (supabase_migrations.applied) records every file that
# has run, keyed by its numeric version prefix. Each unrecorded file runs once,
# inside a single transaction, and is recorded in that same transaction — so a
# failed migration records nothing and the next run retries it. Files already
# in the ledger are skipped, which makes the script safe to run repeatedly.
#
# The connection comes from DATABASE_URL (a libpq connection string). Point it
# at the Supabase session pooler (port 5432), not the transaction pooler
# (6543): `alter type ... add value` and other DDL need session mode.
#
# Usage:
#   DATABASE_URL="postgresql://user:pass@host:5432/postgres?sslmode=require" \
#     scripts/apply_migrations.sh
#
# Flags:
#   --dry-run   List the migrations that would run, then exit without applying.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$REPO_DIR/supabase/migrations"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "error: DATABASE_URL is not set" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is not installed" >&2
  exit 1
fi

# psql invocation: fail on the first SQL error, quiet, no pager.
psql_do() {
  psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --no-psqlrc --quiet "$@"
}

# The ledger lives in its own schema so it never collides with an app table.
psql_do --command "
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.applied (
    version     text primary key,
    name        text not null,
    applied_at  timestamptz not null default now()
  );
"

applied_any=0
for path in "$MIGRATIONS_DIR"/[0-9]*.sql; do
  [ -e "$path" ] || continue
  file="$(basename "$path")"
  version="${file%%_*}"

  already="$(psql_do --tuples-only --no-align --command \
    "select 1 from supabase_migrations.applied where version = '$version';")"
  if [ "$already" = "1" ]; then
    continue
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "would apply: $file"
    applied_any=1
    continue
  fi

  echo "applying: $file"
  # One transaction per file: the migration body and the ledger insert commit
  # together, so a failure leaves no partial record to skip on retry.
  psql_do --single-transaction \
    --file "$path" \
    --command "insert into supabase_migrations.applied (version, name) values ('$version', '$file');"
  applied_any=1
done

if [ "$applied_any" -eq 0 ]; then
  echo "no pending migrations"
fi
