-- =============================================================================
-- Doctoralia appointments ingestion staging table
--
-- Purpose: receive the 2,220-row Doctoralia appointment export from CSV/XLSX,
-- preserve both the simplified guide columns and the richer operational export
-- columns, and expose deterministic keys for idempotent batch upserts.
--
-- No explicit BEGIN/COMMIT is used here; Supabase migration tooling manages
-- migration transactions, and nested wrappers can break preview deployments.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.doctoralia_appointments_ingestion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL,
  sheet_row INTEGER,

  -- Simplified ingestion-guide columns.
  appointment_id TEXT,
  patient_name TEXT,
  patient_email TEXT,
  patient_phone TEXT,
  appointment_date DATE,
  appointment_type TEXT,
  status TEXT,
  notes TEXT,

  -- Rich Doctoralia / Google Sheets operational export columns.
  estado TEXT,
  appointment_time TEXT,
  created_date DATE,
  created_time TEXT,
  subject TEXT,
  agenda TEXT,
  room TEXT,
  confirmed TEXT,
  origin TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  normalized_date DATE,
  doctoralia_id TEXT,
  phone TEXT,
  phone_normalized TEXT,
  treatment TEXT,
  day_num INTEGER,
  month_num INTEGER,
  year_num INTEGER,
  clinic TEXT,

  -- Analytics-ready flags derived by scripts/populate-doctoralia-appointments.js.
  is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  is_jjrt BOOLEAN NOT NULL DEFAULT FALSE,
  is_nursing BOOLEAN NOT NULL DEFAULT FALSE,
  is_control BOOLEAN NOT NULL DEFAULT FALSE,

  raw_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT doctoralia_appointments_ingestion_source_key_not_blank
    CHECK (btrim(source_key) <> '')
);

ALTER TABLE public.doctoralia_appointments_ingestion
  ADD COLUMN IF NOT EXISTS source_key TEXT,
  ADD COLUMN IF NOT EXISTS sheet_row INTEGER,
  ADD COLUMN IF NOT EXISTS appointment_id TEXT,
  ADD COLUMN IF NOT EXISTS patient_name TEXT,
  ADD COLUMN IF NOT EXISTS patient_email TEXT,
  ADD COLUMN IF NOT EXISTS patient_phone TEXT,
  ADD COLUMN IF NOT EXISTS appointment_date DATE,
  ADD COLUMN IF NOT EXISTS appointment_type TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS estado TEXT,
  ADD COLUMN IF NOT EXISTS appointment_time TEXT,
  ADD COLUMN IF NOT EXISTS created_date DATE,
  ADD COLUMN IF NOT EXISTS created_time TEXT,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS agenda TEXT,
  ADD COLUMN IF NOT EXISTS room TEXT,
  ADD COLUMN IF NOT EXISTS confirmed TEXT,
  ADD COLUMN IF NOT EXISTS origin TEXT,
  ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS normalized_date DATE,
  ADD COLUMN IF NOT EXISTS doctoralia_id TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT,
  ADD COLUMN IF NOT EXISTS treatment TEXT,
  ADD COLUMN IF NOT EXISTS day_num INTEGER,
  ADD COLUMN IF NOT EXISTS month_num INTEGER,
  ADD COLUMN IF NOT EXISTS year_num INTEGER,
  ADD COLUMN IF NOT EXISTS clinic TEXT,
  ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_jjrt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_nursing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_control BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS raw_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.doctoralia_appointments_ingestion
SET source_key = COALESCE(
  NULLIF(source_key, ''),
  CASE WHEN doctoralia_id IS NOT NULL AND btrim(doctoralia_id) <> '' THEN 'doctoralia:' || btrim(doctoralia_id) END,
  CASE WHEN appointment_id IS NOT NULL AND btrim(appointment_id) <> '' THEN 'doctoralia:' || btrim(appointment_id) END,
  CASE WHEN sheet_row IS NOT NULL THEN 'source-row:' || sheet_row::TEXT END,
  'legacy-row:' || id::TEXT
)
WHERE source_key IS NULL OR btrim(source_key) = '';

ALTER TABLE public.doctoralia_appointments_ingestion
  ALTER COLUMN source_key SET NOT NULL,
  ALTER COLUMN raw_data SET DEFAULT '{}'::JSONB,
  ALTER COLUMN inserted_at SET DEFAULT NOW(),
  ALTER COLUMN imported_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'doctoralia_appointments_ingestion_source_key_not_blank'
      AND conrelid = 'public.doctoralia_appointments_ingestion'::REGCLASS
  ) THEN
    ALTER TABLE public.doctoralia_appointments_ingestion
      ADD CONSTRAINT doctoralia_appointments_ingestion_source_key_not_blank
      CHECK (btrim(source_key) <> '');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_doctoralia_appointments_ingestion_source_key
  ON public.doctoralia_appointments_ingestion (source_key);

CREATE INDEX IF NOT EXISTS idx_doctoralia_appointments_ingestion_date
  ON public.doctoralia_appointments_ingestion (appointment_date)
  WHERE appointment_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doctoralia_appointments_ingestion_phone_normalized
  ON public.doctoralia_appointments_ingestion (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doctoralia_appointments_ingestion_type
  ON public.doctoralia_appointments_ingestion (appointment_type)
  WHERE appointment_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doctoralia_appointments_ingestion_status
  ON public.doctoralia_appointments_ingestion (status)
  WHERE status IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_touch_doctoralia_appointments_ingestion_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_touch_doctoralia_appointments_ingestion_updated_at
  ON public.doctoralia_appointments_ingestion;
CREATE TRIGGER tr_touch_doctoralia_appointments_ingestion_updated_at
  BEFORE UPDATE ON public.doctoralia_appointments_ingestion
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_touch_doctoralia_appointments_ingestion_updated_at();

COMMENT ON TABLE public.doctoralia_appointments_ingestion IS
  'Doctoralia appointment export staging table for idempotent CSV/XLSX ingestion and downstream acquisition attribution.';
COMMENT ON COLUMN public.doctoralia_appointments_ingestion.source_key IS
  'Stable idempotency key used by scripts/populate-doctoralia-appointments.js for Supabase upserts.';
COMMENT ON COLUMN public.doctoralia_appointments_ingestion.raw_data IS
  'Source-file metadata and preserved operational ingestion context.';
COMMENT ON COLUMN public.doctoralia_appointments_ingestion.imported_at IS
  'Timestamp when the appointment ingestion row was first imported. Kept alongside inserted_at for production compatibility.';

ALTER TABLE public.doctoralia_appointments_ingestion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS doctoralia_appointments_ingestion_service_role_all
  ON public.doctoralia_appointments_ingestion;
CREATE POLICY doctoralia_appointments_ingestion_service_role_all
  ON public.doctoralia_appointments_ingestion
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

REVOKE ALL ON public.doctoralia_appointments_ingestion FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctoralia_appointments_ingestion TO service_role;

