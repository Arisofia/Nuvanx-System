-- Replay-time ratchet for the Control Centre hardening applied immediately before.
-- This migration is assertion-only: it changes no data, schedules no jobs, and
-- fails closed if security_invoker or the owner-scoped backfill dispatcher drift.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'vw_campaign_performance_real'
      AND c.reloptions @> ARRAY['security_invoker=true']::text[]
  ) THEN
    RAISE EXCEPTION 'vw_campaign_performance_real must remain security_invoker';
  END IF;

  IF to_regprocedure('public.nvx_dispatch_meta_lead_backfill_once(uuid,date,date)') IS NULL THEN
    RAISE EXCEPTION 'user-scoped Meta backfill dispatcher missing';
  END IF;
END
$$;
