-- Fix Supabase security_definer_view lint findings on reporting views.
--
-- These reporting relations must execute with the querying role so underlying
-- table privileges and RLS policies are enforced for every caller. The block is
-- intentionally idempotent and skips absent/non-view relations to stay safe in
-- branch replay environments where migrations may be partially applied.

DO $$
DECLARE
  target_views constant text[] := ARRAY[
    'vw_doctoralia_customer_behavior_monthly',
    'v_new_clients_by_channel_detail',
    'vw_doctoralia_lead_traceability_unified',
    'v_figma_meta_signal_health',
    'vw_doctoralia_trazabilidad_360',
    'vw_campaign_performance_real',
    'doctoralia_appointments'
  ];
  target_view text;
  insecure_views text[];
BEGIN
  FOREACH target_view IN ARRAY target_views
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = target_view
        AND c.relkind = 'v'
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', target_view);
    END IF;
  END LOOP;

  SELECT array_agg(c.relname ORDER BY c.relname)
    INTO insecure_views
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ANY (target_views)
    AND c.relkind = 'v'
    AND NOT COALESCE(c.reloptions @> ARRAY['security_invoker=true'], FALSE);

  IF insecure_views IS NOT NULL THEN
    RAISE EXCEPTION 'Reporting views are missing security_invoker=true: %', insecure_views;
  END IF;
END $$;
