-- Restore the doctor performance reporting view security boundary after the
-- 2026-09-01 canonical reporting migration recreated the view without
-- security_invoker.
--
-- SECURITY INVOKER keeps the underlying table RLS policies authoritative for
-- authenticated callers. Anonymous access is not required by the canonical API
-- path and is explicitly removed.

BEGIN;

ALTER VIEW IF EXISTS public.vw_doctor_performance_real
  SET (security_invoker = true);

REVOKE ALL PRIVILEGES ON TABLE public.vw_doctor_performance_real FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON TABLE public.vw_doctor_performance_real FROM authenticated;
GRANT SELECT ON TABLE public.vw_doctor_performance_real TO authenticated, service_role;

COMMENT ON VIEW public.vw_doctor_performance_real IS
  'Doctor performance sourced from Doctoralia appointment ingestion when doctor_id is present, with legacy lead fallback and verified settlement revenue. SECURITY INVOKER: underlying RLS remains authoritative.';

COMMIT;
