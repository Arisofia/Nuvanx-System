# Doctoralia Appointments Ingestion Runbook

## Purpose

Use this runbook to load Doctoralia appointment exports into `public.doctoralia_appointments_ingestion` in Supabase. The ingestion path is designed for repeatable production loads: each row is upserted by a stable `source_key`, so re-running the same export updates existing appointments instead of duplicating them.

## Supported Source Files

The loader supports both of these local export formats:

1. `doctoralia_appointments.csv` in the repository root.
2. `Base Pacientes Nuvanx.xlsx` with the `Doctoralia` sheet.

Override the input file when needed:

```bash
DOCTORALIA_APPOINTMENTS_INPUT_PATH=./exports/doctoralia_appointments.csv npm run doctoralia:appointments:dry-run
```

## Required Environment Variables

Create or update `.env.local` with production Supabase credentials:

```env
SUPABASE_URL=https://ssvvuuysgxyqvmovrlvk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key-from-supabase-settings-api>
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

4. Validate parsing without writing to Supabase:

   ```bash
   npm run doctoralia:appointments:dry-run
   ```

5. Run the ingestion:

   ```bash
   npm run doctoralia:appointments:load
   ```

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

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `Missing SUPABASE_URL...` | Confirm `.env.local` contains `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. |
| `Invalid API key` | Re-copy the service-role key from Supabase Settings → API; do not use the anon key for ingestion. |
| `Doctoralia appointments input not found` | Put `doctoralia_appointments.csv` in the repo root or set `DOCTORALIA_APPOINTMENTS_INPUT_PATH`. |
| `Missing required Doctoralia headers` | Ensure the export includes at least status/estado, appointment date, appointment ID, and patient name columns. |
| Upsert fails on `source_key` | Apply the latest migrations; the loader upserts against `ux_doctoralia_appointments_ingestion_source_key`. |

## Operational Notes

- Default batch size is 500 rows. Override with `DOCTORALIA_APPOINTMENTS_CHUNK_SIZE=1000` for larger exports after testing.
- Phone numbers are normalized for Spanish local matching, preserving raw phone values in `phone` and `patient_phone`.
- The table intentionally keeps direct table access restricted to `service_role` because it stores patient PII.
