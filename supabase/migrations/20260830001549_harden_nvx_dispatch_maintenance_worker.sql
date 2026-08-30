BEGIN;

-- Hardening: SECURITY DEFINER maintenance dispatcher must remain internal-only.
REVOKE EXECUTE
ON FUNCTION public.nvx_dispatch_maintenance_worker(text, date, date)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.nvx_dispatch_maintenance_worker(text, date, date)
TO service_role;

COMMIT;
