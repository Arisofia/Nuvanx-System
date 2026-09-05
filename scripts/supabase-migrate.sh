#!/usr/bin/env bash
# scripts/supabase-migrate.sh
#
# Fail-closed Supabase migration runner.
#
# Contract:
#   1. dry-run the exact migration set first;
#   2. never mutate migration history automatically;
#   3. never retry deterministic SQL/history failures;
#   4. retry only recognized transient transport/upstream failures.
#
# Usage (in GitHub Actions via supabase-link-run composite):
#   bash scripts/supabase-migrate.sh
#
# Local usage (for testing):
#   SESSION_URL="postgresql://...@...5432/postgres" bash scripts/supabase-migrate.sh

set -euo pipefail

if [ -z "${SESSION_URL:-}" ]; then
  echo "::error::SESSION_URL is not set. This script must be called from the supabase-link-run composite action (or with SESSION_URL exported)."
  exit 1
fi

: "${GITHUB_STEP_SUMMARY:=/dev/null}"
touch supabase-migrations.log || true

sanitize_migration_output() {
  sed 's/\x1b\[[0-9;]*m//g'
}

print_migration_output() {
  local input
  input=$(cat)
  printf '%s\n' "$input"
  printf '%s\n' "$input" | sanitize_migration_output >> supabase-migrations.log
}

print_migration_failure_summary() {
  local output="$1"
  local summary sanitized_summary

  summary=$(printf '%s\n' "$output" | awk '
    BEGIN { remaining = 0; found = 0 }
    /ERROR:|SQLSTATE|ErrorResponse|cannot change return type|duplicate key|permission denied|failed to connect|network is unreachable|hostname resolving error|no such host|password authentication failed|could not find valid entry for job|relation .* does not exist|column .* does not exist|function .* does not exist|type .* does not exist|invalid input syntax|checksum|failed to parse|error parsing|migration versions not found|migration history/ {
      if (!found) { found = 1; remaining = 40 }
    }
    found && remaining > 0 { print; remaining-- }
  ')

  if [ -n "$summary" ]; then
    sanitized_summary=$(printf '%s\n' "$summary" | sanitize_migration_output)
    echo "::group::First Supabase migration failure block"
    printf '%s\n' "$sanitized_summary"
    echo "::endgroup::"
    {
      echo
      echo "#### First Supabase migration failure block"
      echo '```text'
      printf '%s\n' "$sanitized_summary"
      echo '```'
    } >> "$GITHUB_STEP_SUMMARY"
  else
    echo "::warning::No known Supabase failure marker was found. Review the debug output or supabase-migrations.log."
  fi
}

# Single source of truth for CLI-output classification. Keep these in sync with
# the Supabase CLI version pinned in .github/actions/supabase-link-run/action.yml.
DETERMINISTIC_PATTERNS=(
  'syntax error'
  'permission denied'
  'not a valid migration'
  'SQLSTATE 42P01'
  'could not find valid entry for job'
  'relation .* does not exist'
  'column .* does not exist'
  'function .* does not exist'
  'type .* does not exist'
  'invalid input syntax'
  'duplicate key'
  'version.*already exists'
  'checksum'
  'failed to parse'
  'error parsing'
  'Remote migration versions not found in local migrations directory'
  'Local migration versions not found in remote migration history'
  'migration history.*out of sync'
)

TRANSIENT_PATTERNS=(
  'failed to connect'
  'connection reset'
  'connection refused'
  'connection timed out'
  'timeout while'
  'network is unreachable'
  'hostname resolving error'
  'temporary failure in name resolution'
  'no such host'
  '502 Bad Gateway'
  '503 Service Unavailable'
  '504 Gateway Timeout'
  'unexpected EOF'
)

is_deterministic_migration_error() {
  local output="$1"
  for pattern in "${DETERMINISTIC_PATTERNS[@]}"; do
    if printf '%s\n' "$output" | grep -Eiq "$pattern"; then
      return 0
    fi
  done
  return 1
}

is_transient_transport_error() {
  local output="$1"
  for pattern in "${TRANSIENT_PATTERNS[@]}"; do
    if printf '%s\n' "$output" | grep -Eiq "$pattern"; then
      return 0
    fi
  done
  return 1
}

run_supabase_push() {
  local mode="$1"
  local output exit_code
  local -a args=(db push --include-all --db-url "$SESSION_URL" --debug)

  if [ "$mode" = "dry-run" ]; then
    args=(db push --dry-run --include-all --db-url "$SESSION_URL" --debug)
  fi

  set +e
  output=$(supabase "${args[@]}" 2>&1)
  exit_code=$?
  set -e

  printf '%s\n' "$output" | print_migration_output
  SUPABASE_PUSH_OUTPUT="$output"
  return "$exit_code"
}

run_db_push_once() {
  local output
  DB_PUSH_RETRYABLE=false

  echo "Validating Supabase migration plan with --dry-run..."
  if ! run_supabase_push dry-run; then
    output="$SUPABASE_PUSH_OUTPUT"
    print_migration_failure_summary "$output"

    if is_deterministic_migration_error "$output"; then
      echo "::error::Supabase dry-run found a deterministic SQL or migration-history mismatch. No database mutation was attempted."
      return 1
    fi

    if is_transient_transport_error "$output"; then
      DB_PUSH_RETRYABLE=true
      echo "::warning::Supabase dry-run failed on a recognized transient transport/upstream condition."
      return 1
    fi

    echo "::error::Supabase dry-run failed for an unclassified reason. Failing closed; no database mutation was attempted."
    return 1
  fi

  echo "Supabase migration dry-run passed; applying the exact validated plan..."
  if run_supabase_push apply; then
    return 0
  fi

  output="$SUPABASE_PUSH_OUTPUT"
  print_migration_failure_summary "$output"

  if is_deterministic_migration_error "$output"; then
    echo "::error::Deterministic Supabase migration failure detected after dry-run. No automatic history mutation or retry will occur."
    return 1
  fi

  if is_transient_transport_error "$output"; then
    DB_PUSH_RETRYABLE=true
    echo "::warning::Supabase apply failed on a recognized transient transport/upstream condition."
    return 1
  fi

  echo "::error::Supabase apply failed for an unclassified reason. Failing closed without automatic history mutation."
  return 1
}

run_with_retry() {
  local max_attempts=3
  local delay_seconds=10
  local attempt=1

  while true; do
    echo "Running Supabase migration contract (attempt $attempt/$max_attempts)..."
    if run_db_push_once; then
      return 0
    fi

    if [ "${DB_PUSH_RETRYABLE:-false}" != "true" ]; then
      return 1
    fi

    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "::error::Supabase migration transport failed after $max_attempts attempts."
      return 1
    fi

    attempt=$((attempt + 1))
    echo "::warning::Retrying recognized transient Supabase transport failure in ${delay_seconds}s."
    sleep "$delay_seconds"
  done
}

run_with_retry
