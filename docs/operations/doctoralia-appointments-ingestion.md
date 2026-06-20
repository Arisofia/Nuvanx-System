# Doctoralia Appointments Ingestion Runbook

## Purpose

Use this runbook to load the canonical NUVANX Doctoralia appointments sheet into `public.doctoralia_appointments_ingestion` in Supabase.

Canonical source:

```text
Base Pacientes Nuvanx > Doctoralia
```

Doctoralia `ID` is a patient/client code, not an appointment identifier. The loader therefore writes appointment-level keys using row/date/time/patient-code/phone/treatment so repeated visits for the same Doctoralia patient are preserved.

## Business Rules

Operational reporting must use only real appointments:

```text
appointment_date < current_date
is_cancelled = false
is_control = false
```

Customer behavior definitions:

| Label | Rule |
| --- | --- |
| `1ra cita` | first real appointment for the patient |
| `nuevo` | second real appointment for the patient |
| `recurrente` | third and later real appointments |
| `churn_90d` | no later appointment within 90 days after the last appointment in a month; only evaluated for months that have matured 90 days |

Identity priority for behavior analysis:

```text
phone_normalized > normalized patient name
```

`Revisión tratamiento` is a real appointment type and must not be classified as an internal control by default.

## Supported Source Files

The loader supports these source formats:

1. Local CSV export, configured through `DOCTORALIA_APPOINTMENTS_INPUT_PATH`.
2. Local XLSX workbook, configured through `DOCTORALIA_APPOINTMENTS_INPUT_PATH` and `DOCTORALIA_APPOINTMENTS_SHEET_NAME`.
3. Google Sheets via `npm run doctoralia:appointments:sync`, which is part of the daily sync orchestrator.

Override the input file when needed:

```bash
DOCTORALIA_APPOINTMENTS_INPUT_PATH="$DOCTORALIA_APPOINTMENTS_INPUT_PATH" npm run doctoralia:appointments:dry-run
```

## Required Environment Variables

Configure these values outside the repository through `.env.local`, GitHub Actions secrets, Vercel env vars, or the deployment secret store:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_DOCTORALIA_SERVICE_ACCOUNT
DOCTORALIA_APPOINTMENTS_SHEET_NAME
DOCTORALIA_APPOINTMENTS_SHEET_RANGE
DOCTORALIA_APPOINTMENTS_MIN_ROWS
```

The daily sync script uses the canonical Base Pacientes Nuvanx spreadsheet unless `DOCTORALIA_ALLOW_NON_CANONICAL_SHEET=true` is explicitly set for a controlled migration.

Do **not** commit `.env.local` or any Supabase service-role key. The service-role key is required because the staging table is protected by RLS and only grants write access to `service_role`.

## Accepted Columns

The parser accepts richer operational Google Sheets headers used by NUVANX, including:

```text
Estado, Fecha, Hora, Fecha creación, Hora creación, Asunto, Agenda,
Sala/Box, Confirmada, Procedencia, Importe, Fecha para normalizar,
ID, Nombre, Teléfono, Tratamiento, Día, Mes, Año, Clínica
```

It also accepts simplified aliases for local recovery files where available.

## Production Load Procedure

1. Install dependencies if needed:

   ```bash
   npm install
   ```

2. Apply Supabase migrations so `public.doctoralia_appointments_ingestion` exists and Doctoralia patient code is not unique:

   ```bash
   npm run supabase:migration:push
   ```

3. Configure the input file or Google Sheets variables in the runtime environment.

4. Validate local parsing without writing to Supabase:

   ```bash
   npm run doctoralia:appointments:dry-run
   ```

5. Validate the production table schema before writing:

   ```bash
   npm run validate:doctoralia-appointments
   ```

6. Run the local file ingestion:

   ```bash
   npm run doctoralia:appointments:load
   ```

7. For automated Google Sheets ingestion, validate and then sync directly from the configured Doctoralia appointments sheet:

   ```bash
   npm run doctoralia:appointments:sync:dry-run
   npm run doctoralia:appointments:sync
   ```

The daily orchestrator validates required secrets, validates the `doctoralia_appointments_ingestion` schema, and runs `sync-doctoralia-appointments`. Production daily sync fails if the appointment agenda cannot be fetched, parsed, loaded, or validated against the configured minimum row count.

## Verification Queries

After ingestion, verify row counts and distributions in Supabase SQL Editor:

```sql
SELECT COUNT(*) AS total_appointments
FROM public.doctoralia_appointments_ingestion;
```

```sql
SELECT
  COUNT(*) AS operational_real_appointments,
  MIN(fecha) AS first_operational_date,
  MAX(fecha) AS last_operational_date
FROM public.doctoralia_appointments;
```

```sql
SELECT
  month,
  first_visit_patients,
  new_patients,
  recurrent_patients,
  churn_90_eligible_patients,
  churned_90d_patients,
  churn_90d_pct
FROM public.vw_doctoralia_customer_behavior_monthly
ORDER BY month;
```

```sql
SELECT
  MIN(appointment_date) AS earliest_appointment,
  MAX(appointment_date) AS latest_appointment,
  COUNT(*) AS total_appointments
FROM public.doctoralia_appointments_ingestion;
```

## Security Verification Queries

Use this catalog query to verify reporting views are running with `security_invoker=true` after migrations:

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
    'vw_acquisition_channel_daily',
    'doctoralia_appointments',
    'vw_doctoralia_customer_behavior_monthly'
  )
ORDER BY c.relname;
```

## Merge-Conflict Resolution Notes

When this branch is rebased or updated from `main`, keep these canonical decisions:

- `supabase/migrations/20260608130000_create_doctoralia_appointments_ingestion.sql` must not include explicit `BEGIN;` / `COMMIT;` wrappers; Supabase tooling controls migration transactions.
- `scripts/validate-sql-migrations.js` should flag only unguarded `ALTER TABLE financial_settlements` statements and should allow `ALTER TABLE IF EXISTS`.
- This runbook should keep local CSV/XLSX and automated Google Sheets paths because production uses both manual recovery and scheduled sync.
- Doctoralia patient code must not be unique in `doctoralia_appointments_ingestion`.
- Daily sync must preserve repeated appointments for the same Doctoralia patient code.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `Missing SUPABASE_URL...` | Confirm the runtime environment contains `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. |
| `Invalid API key` | Re-copy the service-role key from Supabase Settings → API; do not use the anon key for ingestion. |
| `Doctoralia appointments input not found` | Set `DOCTORALIA_APPOINTMENTS_INPUT_PATH` to a readable CSV/XLSX file. |
| Google Sheets 403/404 during automated sync | Share the canonical Doctoralia appointments spreadsheet with the service-account email stored in `GOOGLE_DOCTORALIA_SERVICE_ACCOUNT`. |
| Parsed rows below `DOCTORALIA_APPOINTMENTS_MIN_ROWS` | Check that `DOCTORALIA_APPOINTMENTS_SHEET_NAME` and `DOCTORALIA_APPOINTMENTS_SHEET_RANGE` point to the full appointments agenda. Production should parse at least 1,800 rows. |
| Daily sync preflight fails on missing secrets | Run `npm run validate:daily-sync-config` locally or inspect the workflow preflight output; it prints the exact missing secret names without exposing values. |
| Doctoralia schema validation fails | Run `npm run validate:doctoralia-appointments`; the table must expose every column sent by the loader and `sheet_row`/`source_key` must be available for idempotent upserts. |
| `Missing required Doctoralia headers` | Ensure the export includes at least status/estado, appointment date, Doctoralia patient code, and patient name columns. |
| Upsert fails on `doctoralia_id` uniqueness | Apply the latest Doctoralia migration. Doctoralia ID is a patient code and cannot be unique across appointments. |
| Upsert fails on `source_key` | Apply the latest migrations; the loader upserts against appointment-level `source_key`. |
| `cron.unschedule(...)` says the job does not exist | Re-run migrations after the pg_cron hardening patch; migrations now unschedule by `jobid` only after reading `cron.job`. |
| SQL error at `... final schema ...` | Remove non-SQL snippets before executing SQL. Repository migrations are expected to contain concrete schemas only; `...` is not valid PostgreSQL syntax. |
| `relation public.financial_settlements does not exist` during early replay | Re-run after the migration safety patch; legacy `ALTER TABLE financial_settlements` statements now use `IF EXISTS` and CI blocks regressions. |

## Operational Notes

- Default batch size is 500 rows. Override with `DOCTORALIA_APPOINTMENTS_CHUNK_SIZE` after testing.
- Daily replacement mode is enabled by default to prevent stale partial rows from previous incomplete imports.
- Phone numbers are normalized for Spanish local matching, preserving raw phone values in `phone` and `patient_phone`.
- The table intentionally keeps direct table access restricted to `service_role` because it stores patient PII.
- Production automation uses `DOCTORALIA_APPOINTMENTS_MIN_ROWS` to guard against partial agenda loads and keep the JJRT → Enfermería/control funnel complete.
