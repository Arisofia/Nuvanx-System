# Active process file policy — 2026-06-10

## Active roots

The repository should retain files that directly support one of these processes:

- Frontend source and tests: `frontend/src`, `frontend/tests`, `frontend/scripts`.
- Supabase runtime: `supabase/functions`, `supabase/migrations`, `supabase/config.toml`.
- Operational automation: `.github`, `scripts`, root package manifests.
- Current documentation: `README.md`, `docs/operations`, `docs/sql`, current `docs/audits` files that match live production logic.

## Cleanup rules

- Do not keep generated build output as source.
- Do not keep local editor configuration as source.
- Do not keep duplicate audit documents that contradict the current operational model.
- Do not delete applied Supabase migrations, even if old, because they are deployment history.
- Do not delete scripts referenced by package scripts or GitHub workflows until references are removed first.

## Current Doctoralia rule

The active lead/patient operational model is sequence-driven:

1. First valid Doctoralia appointment: `agendado`.
2. Second valid Doctoralia appointment with JJRT: `convertido`.
3. Second valid appointment without JJRT: `pendiente_revision`.
4. Third valid appointment or later: `recurrente`.
5. Cancelled appointments do not advance state.
6. Payment/revenue is monetization, not patient status.
