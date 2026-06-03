-- =============================================================================
-- Add updated_at columns to tables referenced in phone normalization backfills.
-- The 20260605000000 migration assumes these columns exist for the
-- "SET ... updated_at = NOW()" statements, but some tables were created
-- without an updated_at column.
-- This migration must run BEFORE 20260605000000_* (earlier timestamp).
-- =============================================================================

BEGIN;

-- financial_settlements
ALTER TABLE IF EXISTS public.financial_settlements
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- leads
ALTER TABLE IF EXISTS public.leads
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- produccion_intermediarios
ALTER TABLE IF EXISTS public.produccion_intermediarios
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- doctoralia_patients (conditionally present in some environments)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'doctoralia_patients'
  ) THEN
    ALTER TABLE public.doctoralia_patients
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Add BEFORE UPDATE triggers so that updated_at is maintained automatically
-- on future modifications (using the project-standard handle_updated_at function).
DO $$
BEGIN
  -- financial_settlements
  IF to_regclass('public.financial_settlements') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_financial_settlements_updated_at ON public.financial_settlements;
    CREATE TRIGGER trg_financial_settlements_updated_at
      BEFORE UPDATE ON public.financial_settlements
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  -- produccion_intermediarios
  IF to_regclass('public.produccion_intermediarios') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_produccion_intermediarios_updated_at ON public.produccion_intermediarios;
    CREATE TRIGGER trg_produccion_intermediarios_updated_at
      BEFORE UPDATE ON public.produccion_intermediarios
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  -- doctoralia_patients (if the table exists)
  IF to_regclass('public.doctoralia_patients') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_doctoralia_patients_updated_at ON public.doctoralia_patients;
    CREATE TRIGGER trg_doctoralia_patients_updated_at
      BEFORE UPDATE ON public.doctoralia_patients
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

COMMIT;