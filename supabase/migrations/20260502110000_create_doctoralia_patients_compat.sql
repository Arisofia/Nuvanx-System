-- Ensure Doctoralia patient matching storage exists before historical backfills
-- and scheduled matching functions reference it.
--
-- Supabase Preview databases can start from a reduced/core schema. Several
-- later migrations populate or match against public.doctoralia_patients, so the
-- table must exist before those historical routines are executed.

CREATE TABLE IF NOT EXISTS public.doctoralia_patients (
  doc_patient_id TEXT NOT NULL,
  clinic_id UUID NOT NULL,
  full_name TEXT,
  name_norm TEXT,
  phone_primary TEXT,
  phone_secondary TEXT,
  phone_normalized TEXT,
  lead_id UUID,
  first_seen_at TIMESTAMPTZ,
  match_confidence NUMERIC,
  match_class VARCHAR(32),
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (doc_patient_id, clinic_id)
);

CREATE INDEX IF NOT EXISTS idx_doctoralia_patients_clinic_id
  ON public.doctoralia_patients (clinic_id);

CREATE INDEX IF NOT EXISTS idx_doctoralia_patients_lead_id
  ON public.doctoralia_patients (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doctoralia_patients_phone_primary
  ON public.doctoralia_patients (phone_primary)
  WHERE phone_primary IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doctoralia_patients_phone_normalized
  ON public.doctoralia_patients (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

ALTER TABLE public.doctoralia_patients ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctoralia_patients TO service_role;
GRANT SELECT ON public.doctoralia_patients TO authenticated;
