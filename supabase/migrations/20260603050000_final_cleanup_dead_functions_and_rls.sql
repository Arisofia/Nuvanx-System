-- =============================================================================
-- Final cleanup (Point 6)
-- - Drop dead function is_service_role()
-- - Keep only final RLS migrations (early ones are marked obsolete in previous migration)
-- =============================================================================

-- 1. Drop the dead is_service_role() function if it still exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'is_service_role'
  ) THEN
    DROP FUNCTION IF EXISTS public.is_service_role();
  END IF;
END $$;

-- 2. Ensure we don't have conflicting early RLS policies lingering
-- (early RLS/cron migrations before 20260531 are considered obsolete per consolidation).
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY['leads', 'patients', 'doctoralia_patients', 'financial_settlements'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      -- Drop any very old "anon" or overly permissive policies that may have been left behind
      EXECUTE format('DROP POLICY IF EXISTS %I_select_anon ON public.%I', t, t);
      EXECUTE format('DROP POLICY IF EXISTS %I_all_anon ON public.%I', t, t);
    END IF;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.current_clinic_id() IS
  'Final consolidated version. All early RLS migrations before 20260531 are considered obsolete.';
