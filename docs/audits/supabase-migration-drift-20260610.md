# Supabase Migration Drift Audit — 2026-06-10

## Status
Remote Supabase contains applied migration versions that are not present as local migration files.

## Remote-only versions

- 20260610195903
- 20260610195923
- 20260610200006
- 20260610200018
- 20260610200148

## Resolved local-only version

- Removed invalid local migration: 20260610_create_figma_data_views.sql

## Decision
Do not run supabase migration repair blindly.
Do not delete remote migration history.
Do not edit historical migrations already applied in production.

## Required resolution
1. Recover original SQL for remote-only migrations if available from prior local history, branches, CI artifacts, or Supabase logs.
2. If SQL cannot be recovered, create explicit audit stubs only after confirming they represent already-applied remote changes and are not needed for replay.
3. Future schema corrections must be forward-only migrations.
