BEGIN;

REVOKE ALL
ON FUNCTION public.nvx_sync_lead_cuenta_id()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.nvx_sync_lead_cuenta_id()
TO service_role;

COMMIT;
