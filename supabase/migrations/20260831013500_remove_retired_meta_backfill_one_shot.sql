-- Retire the obsolete one-shot Meta backfill dispatcher.
-- The canonical maintenance path is public.nvx_dispatch_maintenance_worker(...),
-- which already supports the meta-lead-backfill worker. The retired function has
-- no cron jobs, repository consumers, or database dependents.

DROP FUNCTION IF EXISTS public.nvx_dispatch_meta_lead_backfill_once(uuid,date,date);
DROP FUNCTION IF EXISTS public.nvx_dispatch_meta_lead_backfill_once(date,date);
