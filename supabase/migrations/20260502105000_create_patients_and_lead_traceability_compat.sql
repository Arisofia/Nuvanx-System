-- Compatibility scaffolding for historical lead traceability migrations.
--
-- Some Supabase environments carry public.patients from production bootstrap
-- state instead of repository migrations. Preview/repair deployments replaying the
-- repository history need the same minimal table and lead columns before older
-- vw_lead_traceability migrations compile.

CREATE TABLE IF NOT EXISTS public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID,
  name TEXT,
  dni TEXT,
  dni_hash TEXT,
  phone TEXT,
  phone_normalized TEXT,
  total_ltv NUMERIC NOT NULL DEFAULT 0,
  last_visit TIMESTAMPTZ,
  doctoralia_patient_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS clinic_id UUID,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS dni TEXT,
  ADD COLUMN IF NOT EXISTS dni_hash TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT,
  ADD COLUMN IF NOT EXISTS total_ltv NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_visit TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS doctoralia_patient_id TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS public.leads
  ADD COLUMN IF NOT EXISTS dni TEXT,
  ADD COLUMN IF NOT EXISTS dni_hash TEXT,
  ADD COLUMN IF NOT EXISTS first_outbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply_delay_minutes NUMERIC,
  ADD COLUMN IF NOT EXISTS lost_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_patients_clinic_id_compat
  ON public.patients (clinic_id)
  WHERE clinic_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_phone_normalized_compat
  ON public.patients (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_dni_hash_compat
  ON public.patients (dni_hash)
  WHERE dni_hash IS NOT NULL;

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.patients TO service_role;
GRANT SELECT ON public.patients TO authenticated;
