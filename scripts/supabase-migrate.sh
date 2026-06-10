#!/usr/bin/env bash
# scripts/supabase-migrate.sh
#
# Robust Supabase migration runner with retry, ghost repair, and failure analysis.
#
# Usage (in GitHub Actions via supabase-link-run composite):
#   bash scripts/supabase-migrate.sh
#
# Local usage (for testing):
#   SESSION_URL="postgresql://...@...5432/postgres" bash scripts/supabase-migrate.sh
#
# Requirements:
#   - supabase CLI installed and authenticated (or SESSION_URL provided)
#   - SESSION_URL must point to a Session Pooler (port 5432) for best reliability.
#
# This script was extracted from .github/workflows/deploy.yml for:
#   - Better maintainability
#   - Proper shellcheck coverage
#   - Easier local testing and iteration

set -euo pipefail

# Ensure SESSION_URL is available
if [ -z "${SESSION_URL:-}" ]; then
  echo "::error::SESSION_URL is not set. This script must be called from the supabase-link-run composite action (or with SESSION_URL exported)."
  exit 1
fi

# Ensure log file exists (for local runs and to avoid sed/append issues)
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

append_migration_log() {
  sanitize_migration_output >> supabase-migrations.log
}

print_migration_failure_summary() {
  local output="$1"
  local summary sanitized_summary
  summary=$(printf '%s\n' "$output" | awk '
    BEGIN { remaining = 0; found = 0 }
    /ERROR:|SQLSTATE|ErrorResponse|cannot change return type|duplicate key|permission denied|failed to connect|network is unreachable|hostname resolving error|no such host|password authentication failed|could not find valid entry for job|relation .* does not exist|column .* does not exist|function .* does not exist|type .* does not exist|invalid input syntax|checksum|failed to parse|error parsing/ {
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
    echo "::warning::No ERROR, SQLSTATE, ErrorResponse, connection, or known SQL failure marker was found in the Supabase CLI output. Review the full --debug output above or download supabase-migrations.log."
  fi
}

is_deterministic_migration_error() {
  local output="$1"
  # Keep error patterns reasonably in sync with similar logic in
  # .github/actions/supabase-link-run/action.yml (link errors) and other workflows.
  local -a patterns=(
    'syntax error'
    'permission denied'
    'not a valid migration'
    'hostname resolving error'
    'no such host'
    'SQLSTATE 42P01'
    'could not find valid entry for job'
    'relation .* does not exist'
    'column .* does not exist'
    'function .* does not exist'
    'type .* does not exist'
    'invalid input syntax'
    'checksum'
    'failed to parse'
    'error parsing'
  )
  for p in "${patterns[@]}"; do
    if echo "$output" | grep -Eiq "$p"; then
      return 0
    fi
  done
  return 1
}

run_db_push_once() {
  local output exit_code ghosts dup_version missing_remotes
  DB_PUSH_RETRYABLE=true

  output=$(supabase db push --include-all --db-url "$SESSION_URL" --debug 2>&1)
  exit_code=$?
  printf '%s\n' "$output" | print_migration_output

  if [ "$exit_code" -eq 0 ]; then
    return 0
  fi

  print_migration_failure_summary "$output"

  # 1) Handle explicit repair suggestions for "ghost" (reverted) migrations
  ghosts=$(echo "$output" | grep "supabase migration repair --status reverted" | sed 's/.*reverted //' || true)
  if [ -n "$ghosts" ]; then
    for version in $ghosts; do
      echo "::warning::Repairing ghost migration $version"
      printf '%s\n' "Repairing ghost migration $version" | append_migration_log
      output=$(supabase migration repair --status reverted "$version" --db-url "$SESSION_URL" --debug 2>&1)
      exit_code=$?
      printf '%s\n' "$output" | print_migration_output
      if [ "$exit_code" -ne 0 ]; then
        return "$exit_code"
      fi
    done
    output=$(supabase db push --include-all --db-url "$SESSION_URL" --debug 2>&1)
    exit_code=$?
    printf '%s\n' "$output" | print_migration_output
    return "$exit_code"
  fi

  # 2) Handle "Remote migration versions not found in local migrations directory"
  # This often happens when migrations are deleted locally but remain in schema_migrations remotely.
  # Extract versions from the suggested repair command line, which is more reliable.
  missing_remotes_from_suggestion=$(echo "$output" | grep "supabase migration repair --status reverted" | grep -oE '[0-9]{8,}' | tr '\n' ' ' || true)
  if [ -n "$missing_remotes_from_suggestion" ]; then
    missing_remotes=$(echo "$missing_remotes_from_suggestion" | tr ' ' '\n') # Convert space-separated to newline-separated
    for version in $missing_remotes; do
      echo "::warning::Removing orphaned remote migration record: $version (missing locally)"
      printf '%s\n' "Removing orphaned remote migration record: $version" | append_migration_log
      output=$(supabase migration repair --status reverted "$version" --db-url "$SESSION_URL" --debug 2>&1)
      exit_code=$?
      printf '%s\n' "$output" | print_migration_output
      if [ "$exit_code" -ne 0 ]; then
        return "$exit_code"
      fi
    done
    echo "Retrying db push after repairing orphaned remote records..."
    output=$(supabase db push --include-all --db-url "$SESSION_URL" --debug 2>&1)
    exit_code=$?
    printf '%s\n' "$output" | print_migration_output
    return "$exit_code"
  fi

  dup_version=$(echo "$output" | grep -oE 'Key \(version\)=\([0-9]+\) already exists' | grep -oE '[0-9]+' || true)
  if [ -n "$dup_version" ]; then
    echo "::error::Migration version $dup_version already exists in supabase_migrations.schema_migrations. Check for duplicate local migration prefixes or a remote history mismatch before retrying."
    DB_PUSH_RETRYABLE=false
    return "$exit_code"
  fi

  # Correct bash syntax: call function without parentheses around arguments.
  if is_deterministic_migration_error "$output"; then
    echo "::error::Non-transient Supabase migration error detected. Not retrying; fix the SQL/CLI error shown above."
    DB_PUSH_RETRYABLE=false
    return "$exit_code"
  fi

  return "$exit_code"
}

run_with_retry() {
  local max_attempts=3
  local delay_seconds=10
  local attempt=1

  while true; do
    echo "Running Supabase migrations (attempt $attempt/$max_attempts)..."
    if run_db_push_once; then
      return 0
    fi

    if [ "${DB_PUSH_RETRYABLE:-true}" = "false" ]; then
      return 1
    fi

    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "::error::Supabase migrations failed after $max_attempts attempts. Review the --debug output above for the failing endpoint or SQL error."
      return 1
    fi

    attempt=$((attempt + 1))
    echo "::warning::Supabase migrations failed, retrying in ${delay_seconds}s in case this was a transient upstream/proxy error."
    sleep "$delay_seconds"
  done
}

run_with_retry
