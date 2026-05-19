-- =============================================================================
-- Security advisor cleanup for Supabase preview environments
--
-- Consolidates search_path lockdown, RLS enforcement for produccion_intermediarios,
-- and pg_cron extension policy drift removal.
-- =============================================================================

BEGIN;

-- 1. Lock down mutable function search_path warnings across matching overloads.
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

-- 2. Ensure produccion_intermediarios RLS is active and policies are clean.
DO $$
BEGIN
  IF to_regclass('public.produccion_intermediarios') IS NOT NULL THEN
    ALTER TABLE public.produccion_intermediarios ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados" ON public.produccion_intermediarios;
    DROP POLICY IF EXISTS "Permitir lectura solo a authenticated" ON public.produccion_intermediarios;
    DROP POLICY IF EXISTS produccion_intermediarios_authenticated_select ON public.produccion_intermediarios;
    DROP POLICY IF EXISTS produccion_intermediarios_service_role_all ON public.produccion_intermediarios;

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

-- 3. Hosted Supabase does not allow altering pg_cron-owned tables (cron.job*).
--    Keep this migration focused on public schema hardening only.

COMMIT;
