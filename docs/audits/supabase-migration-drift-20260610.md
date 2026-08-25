# Supabase migration drift audit — 2026-06-10

## Status

**CLOSED / HISTORICAL RECORD**

This file is retained as an incident/audit record, not as a current remediation plan.

## Historical finding

The 2026-06-10 audit identified five migration versions that were present in the remote migration ledger without matching migration files in the repository at that time:

- `20260610195903`
- `20260610195923`
- `20260610200006`
- `20260610200018`
- `20260610200148`

The original risk was that a fresh replay from repository files alone could not explain those remote-only ledger entries.

## Current verification

On 2026-08-26 the production project `ssvvuuysgxyqvmovrlvk` migration ledger was re-read through the connected Supabase project API. None of the five versions above is present in the current production migration list.

Therefore the specific remote-only drift described by the 2026-06-10 audit is no longer an active migration-ledger divergence.

## Closure rule

Do **not** recreate these historical versions as new migration files merely to match this audit record. Applied/current schema changes remain governed by the repository's forward-only migration history and `scripts/validate-sql-migrations.js`.

If any of these versions appears again in a future production ledger comparison, open a new drift incident and compare repository migration history, the remote ledger and effective schema before making changes.

## Provenance

This record intentionally preserves the historical version identifiers after closure so future operators can distinguish a previously reconciled incident from a newly introduced drift.
