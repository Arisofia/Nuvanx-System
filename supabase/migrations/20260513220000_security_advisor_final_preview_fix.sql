-- =============================================================================
-- Final preview security advisor fix
--
-- Forward-only cleanup for warnings still reported by Supabase Preview:
-- - mutable function search_path on legacy helper/RPC functions
-- - anonymous-access advisor warning on produccion_intermediarios read policy
-- - anonymous-access advisor warning on pg_cron extension policies
--
-- Note: auth_leaked_password_protection is a Supabase Auth dashboard setting and
-- cannot be enabled through SQL migrations.
-- =============================================================================

-- 1. Lock down search_path for every existing overload of the flagged functions.
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

-- 2. Make produccion_intermediarios access explicit: service_role can manage all
-- rows, and non-anonymous authenticated users can read. Anonymous sessions that
-- carry the authenticated role remain excluded by the is_anonymous claim guard.
DO $$
BEGIN
  IF to_regclass('public.produccion_intermediarios') IS NOT NULL THEN
    ALTER TABLE public.produccion_intermediarios ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados"
      ON public.produccion_intermediarios;
    DROP POLICY IF EXISTS "Permitir lectura solo a authenticated"
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

    CREATE POLICY produccion_intermediarios_authenticated_select
      ON public.produccion_intermediarios
      FOR SELECT
      TO authenticated
      USING (
        (SELECT auth.role()) = 'authenticated'
        AND (SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
      );
  END IF;
END $$;

-- 3. Remove pg_cron policy drift that includes anon/public, then recreate explicit
-- service_role-only policies when the extension tables are present.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS cron_job_policy ON cron.job;
    CREATE POLICY cron_job_policy
      ON cron.job
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  END IF;

  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    ALTER TABLE cron.job_run_details ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS cron_job_run_details_policy ON cron.job_run_details;
    CREATE POLICY cron_job_run_details_policy
      ON cron.job_run_details
      FOR SELECT
      TO service_role
      USING (TRUE);
  END IF;
END $$;
