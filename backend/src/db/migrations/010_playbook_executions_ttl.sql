-- Migration 010: playbook_executions TTL — auto-delete rows older than 30 days
-- Prevents unbounded growth from AI response JSONs stored in result_data.
-- Uses a function + periodic cleanup rather than pg_cron (requires extension).
-- The backend calls /api/admin/cleanup or this runs via Supabase scheduled function.

-- ─── Cleanup function ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_old_playbook_executions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.playbook_executions
  WHERE created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ─── Grant execution to service role only ────────────────────────────────────
REVOKE ALL ON FUNCTION public.cleanup_old_playbook_executions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_playbook_executions() TO service_role;

-- ─── Index to make the delete fast ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_playbook_executions_created_at
  ON public.playbook_executions (created_at);

-- ─── Optional: enable pg_cron if available (Supabase has it on all plans) ────
-- Uncomment after confirming pg_cron is enabled in Supabase Dashboard:
--   Database → Extensions → pg_cron → Enable
--
-- SELECT cron.schedule(
--   'cleanup-playbook-executions',     -- job name
--   '0 3 * * *',                       -- daily at 03:00 UTC
--   $$SELECT public.cleanup_old_playbook_executions()$$
-- );
