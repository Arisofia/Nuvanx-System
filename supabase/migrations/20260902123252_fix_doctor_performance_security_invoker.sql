-- Restore the reporting-view security boundary after the 2026-09-01 view recreation.
-- The view must execute with caller privileges so underlying RLS remains authoritative.

ALTER VIEW IF EXISTS public.vw_doctor_performance_real
  SET (security_invoker = true);

-- This is a read-only reporting surface. Anonymous access is not required.
REVOKE ALL PRIVILEGES ON TABLE public.vw_doctor_performance_real FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON TABLE public.vw_doctor_performance_real FROM authenticated;
GRANT SELECT ON TABLE public.vw_doctor_performance_real TO authenticated, service_role;

COMMENT ON VIEW public.vw_doctor_performance_real IS
  'Doctor performance sourced from Doctoralia appointment ingestion when doctor_id is present, with legacy lead fallback and verified settlement revenue. SECURITY INVOKER: underlying RLS remains authoritative.';
