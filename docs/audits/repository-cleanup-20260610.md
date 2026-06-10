# Repository cleanup audit — 2026-06-10

## Scope

This cleanup keeps only files that are part of the active operating process: application source, Supabase functions, Supabase migrations, operational scripts, workflow configuration, tests, and current audit documentation.

## Removed in cleanup branch

- `src/app/hooks/useFigmaData.ts`: legacy hook outside the active `frontend/src` application tree.
- `.vscode/settings.json`: editor-local workspace configuration.
- `docs/audits/doctoralia-sequence-auto-status-20260610.md`: superseded by the final sequential Doctoralia status audit.
- `docs/audits/patient-new-vs-paid-logic-20260610.md`: superseded because it used outdated identity priority.
- `docs/audits/source-to-cash-reconciliation-20260610.md`: superseded by Doctoralia sequence logic and decoupled monetization.

## Explicitly retained

- `supabase/migrations`: retained because applied migrations are execution history and deployment contract.
- `supabase/functions`: retained as active Edge Function source.
- `scripts`: retained where used by package scripts, workflows, Doctoralia sync, Meta sync, validation, or production checks.
- `frontend/src`: retained as active app source.
- `.github`: retained as active CI/CD governance.

## Current status model

- First valid Doctoralia appointment = `agendado`.
- Second valid Doctoralia appointment with JJRT = `convertido`.
- Second valid appointment without JJRT = `pendiente_revision`.
- Third valid appointment or later = `recurrente`.
- Cancelled appointments do not advance sequence.
- Revenue and payment remain separate monetization dimensions.
