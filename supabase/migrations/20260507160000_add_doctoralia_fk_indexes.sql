-- Add missing covering indexes for Doctoralia foreign keys and improve query performance.
-- This migration is idempotent and guarded for databases with partial historical schemas.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'doctoralia_lead_matches'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_doctoralia_lead_matches_lead_id_fk_cover
      ON public.doctoralia_lead_matches(lead_id);
    ANALYZE public.doctoralia_lead_matches;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'doctoralia_patients'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_doctoralia_patients_clinic_id_fk_cover
      ON public.doctoralia_patients(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_doctoralia_patients_lead_id_fk_cover
      ON public.doctoralia_patients(lead_id);
    ANALYZE public.doctoralia_patients;
  END IF;
END $$;
