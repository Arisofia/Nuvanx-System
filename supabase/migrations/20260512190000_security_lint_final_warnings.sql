-- =============================================================================
-- Final Supabase security-advisor warning cleanup
--
-- Fixes:
--   - get_trazabilidad_funnel legacy 6-arg SECURITY DEFINER overload
--   - get_trazabilidad_funnel mutable search_path warning
--   - documents hosted pg_cron policy ownership limitations
--
-- Note: auth_leaked_password_protection is a hosted Auth setting and cannot be
-- changed via SQL migrations. It must be enabled in the Supabase dashboard.
-- =============================================================================

-- Remove the legacy public RPC overload flagged by the advisor. The Edge
-- Function uses the 7-argument service-role RPC with p_user_id.
DROP FUNCTION IF EXISTS public.get_trazabilidad_funnel(
  DATE, DATE, DATE, DATE, DATE, DATE
);

-- Keep the active service-role RPC hardened and deterministic.
DO $$
BEGIN
  IF to_regprocedure('public.get_trazabilidad_funnel(uuid,date,date,date,date,date,date)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.get_trazabilidad_funnel(UUID, DATE, DATE, DATE, DATE, DATE, DATE) SECURITY INVOKER';
    EXECUTE 'ALTER FUNCTION public.get_trazabilidad_funnel(UUID, DATE, DATE, DATE, DATE, DATE, DATE) SET search_path = public';
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_trazabilidad_funnel(UUID, DATE, DATE, DATE, DATE, DATE, DATE) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_trazabilidad_funnel(UUID, DATE, DATE, DATE, DATE, DATE, DATE) TO service_role';
  END IF;
END $$;

-- pg_cron is owned by Supabase-managed roles on hosted projects. The migration
-- runner cannot reliably change grants or RLS policies on cron.job or
-- cron.job_run_details on all platforms. On some hosted environments, this
-- blocks deployment with SQLSTATE 42501 (must be owner of relation job).
--
-- We attempt to recreate them without anon/PUBLIC so the advisor no longer
-- flags anonymous access, but wrap in exception blocks to allow the migration
-- to pass if privileges are restricted.
DO $$
BEGIN
  BEGIN
    IF to_regclass('cron.job') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON TABLE cron.job FROM PUBLIC, anon';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_policy ON cron.job';
      EXECUTE 'CREATE POLICY cron_job_policy ON cron.job FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron.job hardening due to insufficient privileges (likely hosted Supabase)';
  END;

  BEGIN
    IF to_regclass('cron.job_run_details') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON TABLE cron.job_run_details FROM PUBLIC, anon';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_run_details_policy ON cron.job_run_details';
      EXECUTE 'CREATE POLICY cron_job_run_details_policy ON cron.job_run_details FOR SELECT TO service_role USING (true)';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron.job_run_details hardening due to insufficient privileges (likely hosted Supabase)';
  END;
END $$;
