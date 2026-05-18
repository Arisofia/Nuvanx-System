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
        'get_campaigns_filter',
        'get_campaign_roi'
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

    -- Explicitly revoke permissions from roles that allow anonymous access
    REVOKE ALL ON public.produccion_intermediarios FROM anon, public;

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

-- 3. Remove pg_cron policy drift. service_role bypasses RLS, so dropping 
-- policies is the safest way to satisfy the anonymous access advisor on 
-- extension tables while keeping them functional for the system.
DO $$
BEGIN
  BEGIN
    IF to_regclass('cron.job') IS NOT NULL THEN
      ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON cron.job FROM anon, authenticated, public;
      DROP POLICY IF EXISTS cron_job_policy ON cron.job;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron.job hardening due to insufficient privileges';
  END;

  BEGIN
    IF to_regclass('cron.job_run_details') IS NOT NULL THEN
      ALTER TABLE cron.job_run_details ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON cron.job_run_details FROM anon, authenticated, public;
      DROP POLICY IF EXISTS cron_job_run_details_policy ON cron.job_run_details;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron.job_run_details hardening due to insufficient privileges';
  END;
END $$;

-- 4. Guard get_campaign_roi dependency
-- This addresses the "relation public.vw_lead_traceability does not exist" error
-- seen in preview builds. If the view is missing, we ensure the function 
-- search_path is still hardened if the function exists, but we don't attempt
-- to recreate the logic here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c 
    JOIN pg_namespace n ON n.oid = c.relnamespace 
    WHERE n.nspname = 'public' AND c.relname = 'vw_lead_traceability'
  ) THEN
    RAISE NOTICE 'Dependency public.vw_lead_traceability is missing. Function public.get_campaign_roi may be in a broken state.';
  ELSE
    -- If the view exists, we ensure execute permissions are restricted 
    -- to service_role to satisfy security advisor.
    IF to_regprocedure('public.get_campaign_roi(uuid,text,text,text)') IS NOT NULL THEN
      REVOKE ALL ON FUNCTION public.get_campaign_roi(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.get_campaign_roi(uuid,text,text,text) TO service_role;
    END IF;
  END IF;
END $$;

-- Note on auth_leaked_password_protection:
-- This is a Supabase Auth dashboard setting and cannot be enabled through SQL.
-- Navigate to Authentication -> Settings -> Password Protection in the 
-- Supabase Dashboard to enable "Leaked password protection".
-- -----------------------------------------------------------------------------
