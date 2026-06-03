-- Grant EXECUTE on current_clinic_id() and current_user_id() to authenticated and anon roles.
-- These SECURITY DEFINER helpers are called from RLS policies (e.g. USING (clinic_id = (SELECT public.current_clinic_id())) ).
-- Without explicit GRANT, the authenticated user gets "permission denied for function current_clinic_id"
-- when the policy is evaluated during SELECT/INSERT etc. on tables like integrations, leads, etc.
--
-- This fixes the error seen on /integrations page load.
-- The functions are already hardened with search_path and safe JWT handling.

DO $$
BEGIN
  -- current_clinic_id
  IF to_regprocedure('public.current_clinic_id()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.current_clinic_id() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.current_clinic_id() TO anon;
    -- service_role usually bypasses RLS but grant for completeness
    GRANT EXECUTE ON FUNCTION public.current_clinic_id() TO service_role;
  END IF;

  -- current_user_id
  IF to_regprocedure('public.current_user_id()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.current_user_id() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.current_user_id() TO anon;
    GRANT EXECUTE ON FUNCTION public.current_user_id() TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.current_clinic_id() IS
  'Returns the clinic_id for the current authenticated user. Robust version. GRANTs added 2026-06-08 to allow RLS evaluation.';

COMMENT ON FUNCTION public.current_user_id() IS
  'Safe wrapper around auth.uid(). GRANTs added 2026-06-08 to allow RLS evaluation.';
