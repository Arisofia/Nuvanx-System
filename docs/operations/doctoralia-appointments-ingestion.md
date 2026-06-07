# Doctoralia Appointments Ingestion Runbook

## Purpose

Use this runbook to load Doctoralia appointment exports into `public.doctoralia_appointments_ingestion` in Supabase. The ingestion path is designed for repeatable production loads: each row is upserted by a stable `source_key`, so re-running the same export updates existing appointments instead of duplicating them.

## Supported Source Files

The loader supports both of these local export formats:

1. `doctoralia_appointments.csv` in the repository root.
2. `Base Pacientes Nuvanx.xlsx` with the `Doctoralia` sheet.
3. Google Sheets via `npm run doctoralia:appointments:sync`, which is now part of the daily sync orchestrator.

Override the input file when needed:

```bash
DOCTORALIA_APPOINTMENTS_INPUT_PATH=./exports/doctoralia_appointments.csv npm run doctoralia:appointments:dry-run
```

## Required Environment Variables

Create or update `.env.local` with production Supabase credentials:

```env
SUPABASE_URL=https://ssvvuuysgxyqvmovrlvk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key-from-supabase-settings-api>
DOCTORALIA_SHEET_ID=<google-sheet-id-for-appointments-sync>
GOOGLE_DOCTORALIA_SERVICE_ACCOUNT=<service-account-json>
```

Do **not** commit `.env.local` or any Supabase service-role key. The service-role key is required because the staging table is protected by RLS and only grants write access to `service_role`.

## Accepted Columns

The CSV/XLSX parser accepts the simplified Doctoralia export columns:

```text
appointment_id, patient_name, patient_email, patient_phone,
appointment_date, appointment_type, status, notes
```

It also accepts the richer operational Google Sheets headers used by NUVANX, including Spanish aliases such as `Estado`, `Fecha`, `Hora`, `Asunto`, `Agenda`, `Importe`, `ID`, `Nombre`, `Teléfono`, `Tratamiento`, and `Clínica`.

## Production Load Procedure

1. Install dependencies if needed:

   ```bash
   npm install
   ```

2. Apply Supabase migrations so `public.doctoralia_appointments_ingestion` exists:

   ```bash
   npm run supabase:migration:push
   ```

3. Place the export in the repo root as `doctoralia_appointments.csv`, or set `DOCTORALIA_APPOINTMENTS_INPUT_PATH`.

4. Validate local parsing without writing to Supabase:

   ```bash
   npm run doctoralia:appointments:dry-run
   ```

5. Run the local file ingestion:

   ```bash
   npm run doctoralia:appointments:load
   ```

6. For automated Google Sheets ingestion, validate and then sync directly from the Doctoralia appointments sheet:

   ```bash
   DOCTORALIA_APPOINTMENTS_MIN_ROWS=2200 npm run doctoralia:appointments:sync:dry-run
   DOCTORALIA_APPOINTMENTS_MIN_ROWS=2200 npm run doctoralia:appointments:sync
   ```

The daily orchestrator also runs `sync-doctoralia-appointments` as a critical step, so production daily sync fails if the appointment agenda cannot be fetched, parsed, loaded, or validated against the configured minimum row count.

## Verification Queries

After ingestion, verify row counts and distributions in Supabase SQL Editor:

```sql
SELECT COUNT(*) AS total_appointments
FROM public.doctoralia_appointments_ingestion;
```

```sql
SELECT
  appointment_type,
  COUNT(*) AS appointment_count,
  ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM public.doctoralia_appointments_ingestion), 0), 2) AS percentage
FROM public.doctoralia_appointments_ingestion
GROUP BY appointment_type
ORDER BY appointment_count DESC;
```

```sql
SELECT
  status,
  COUNT(*) AS appointment_count
FROM public.doctoralia_appointments_ingestion
GROUP BY status
ORDER BY appointment_count DESC;
```

```sql
SELECT
  MIN(appointment_date) AS earliest_appointment,
  MAX(appointment_date) AS latest_appointment,
  COUNT(*) AS total_appointments
FROM public.doctoralia_appointments_ingestion;
```


## Security Verification Queries

Use this catalog query to verify reporting views are actually running with `security_invoker=true` after migrations. It checks PostgreSQL `pg_class.reloptions` directly instead of relying on UI labels:

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS view_name,
  COALESCE(c.reloptions @> ARRAY['security_invoker=true'], FALSE) AS security_invoker_enabled,
  c.reloptions
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'v'
  AND c.relname IN (
    'v_new_clients_by_channel_monthly',
    'v_new_clients_by_channel_detail',
    'v_patient_conversion_funnel',
    'vw_source_comparison',
    'vw_acquisition_channel_daily'
  )
ORDER BY c.relname;
```

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `Missing SUPABASE_URL...` | Confirm `.env.local` contains `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. |
| `Invalid API key` | Re-copy the service-role key from Supabase Settings → API; do not use the anon key for ingestion. |
| `Doctoralia appointments input not found` | Put `doctoralia_appointments.csv` in the repo root or set `DOCTORALIA_APPOINTMENTS_INPUT_PATH`. |
| Google Sheets 403/404 during automated sync | Share the Doctoralia appointments spreadsheet with the service-account email stored in `GOOGLE_DOCTORALIA_SERVICE_ACCOUNT`. |
| Parsed rows below `DOCTORALIA_APPOINTMENTS_MIN_ROWS` | Check that `DOCTORALIA_APPOINTMENTS_SHEET_NAME` and `DOCTORALIA_APPOINTMENTS_SHEET_RANGE` point to the full appointments agenda, not the financial/caja tab. |
| `Missing required Doctoralia headers` | Ensure the export includes at least status/estado, appointment date, appointment ID, and patient name columns. |
| Upsert fails on `source_key` | Apply the latest migrations; the loader upserts against `ux_doctoralia_appointments_ingestion_source_key`. |
| `cron.unschedule(...)` says the job does not exist | Re-run migrations after the pg_cron hardening patch; migrations now unschedule by `jobid` only after reading `cron.job`. |
| SQL error at `... final schema ...` | Remove placeholder snippets before executing SQL. Repository migrations are expected to contain concrete schemas only; `...` is not valid PostgreSQL syntax. |

## Operational Notes

- Default batch size is 500 rows. Override with `DOCTORALIA_APPOINTMENTS_CHUNK_SIZE=1000` for larger exports after testing.
- Phone numbers are normalized for Spanish local matching, preserving raw phone values in `phone` and `patient_phone`.
- The table intentionally keeps direct table access restricted to `service_role` because it stores patient PII.
- Production automation sets `DOCTORALIA_APPOINTMENTS_MIN_ROWS=2200` to guard against partial agenda loads and keep the JJRT → Enfermería/control funnel complete.
