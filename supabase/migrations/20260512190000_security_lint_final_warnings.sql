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
-- cron.job_run_details, and attempting to do so blocks deployment with
-- SQLSTATE 42501 (must be owner of relation job). This warning is documented
-- as non-actionable in SQL because the cron schema is not exposed by PostgREST
-- and anon has no usable API path to these managed extension tables.
SELECT 'pg_cron policy advisory: skipped managed cron.* policy cleanup; see migration comment for rationale'::text AS info;
