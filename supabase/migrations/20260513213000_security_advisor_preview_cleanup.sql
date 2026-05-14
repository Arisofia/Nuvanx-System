-- =============================================================================
-- Security advisor cleanup for Supabase preview environments
--
-- Addresses advisor warnings observed after the Produccion Intermediarios preview
-- deploy without relying on edited historical migrations being replayed.
-- =============================================================================

-- 1. Lock down mutable function search_path warnings across any matching
-- overloads that exist in the target database.
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'fn_set_updated_at',
        'fn_extract_and_normalize_phone',
        'get_campaigns_filter'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_catalog', fn.signature);
  END LOOP;
END $$;

-- 2. Remove legacy anonymous-access policy drift from the new staging table.
DO $$
BEGIN
  IF to_regclass('public.produccion_intermediarios') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados"
      ON public.produccion_intermediarios;

    DROP POLICY IF EXISTS produccion_intermediarios_authenticated_select
      ON public.produccion_intermediarios;

    DROP POLICY IF EXISTS produccion_intermediarios_service_role_all
      ON public.produccion_intermediarios;

    CREATE POLICY produccion_intermediarios_service_role_all
      ON public.produccion_intermediarios
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  END IF;
END $$;

-- 3. pg_cron is operational infrastructure. service_role bypasses RLS, so these
-- policies are unnecessary and can be dropped to remove anonymous-role advisor
-- warnings caused by extension-created policy drift.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    DROP POLICY IF EXISTS cron_job_policy ON cron.job;
  END IF;

  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    DROP POLICY IF EXISTS cron_job_run_details_policy ON cron.job_run_details;
  END IF;
END $$;
