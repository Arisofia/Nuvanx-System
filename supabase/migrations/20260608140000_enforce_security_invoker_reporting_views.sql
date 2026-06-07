-- =============================================================================
-- Enforce SECURITY INVOKER on reporting views touched by dashboard/attribution work.
--
-- CREATE OR REPLACE VIEW can reset reloptions. This migration is intentionally
-- idempotent for fresh databases and existing upgrades: missing views are skipped,
-- existing views are altered, then catalog reloptions are checked directly.
-- =============================================================================

DO $$
DECLARE
  target_view TEXT;
  target_views TEXT[] := ARRAY[
    'v_new_clients_by_channel_monthly',
    'v_new_clients_by_channel_detail',
    'v_patient_conversion_funnel',
    'vw_source_comparison',
    'vw_acquisition_channel_daily',
    'vw_campaign_performance_real',
    'vw_lead_traceability',
    'vw_doctoralia_lead_traceability_unified'
  ];
  insecure_views TEXT[];
BEGIN
  FOREACH target_view IN ARRAY target_views LOOP
    IF to_regclass(format('public.%I', target_view)) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', target_view);
    END IF;
  END LOOP;

  SELECT array_agg(c.relname ORDER BY c.relname)
  INTO insecure_views
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'v'
    AND c.relname = ANY(target_views)
    AND NOT COALESCE(c.reloptions @> ARRAY['security_invoker=true'], FALSE);

  IF insecure_views IS NOT NULL THEN
    RAISE EXCEPTION 'Reporting views are missing security_invoker=true: %', insecure_views;
  END IF;

  IF to_regclass('public.vw_source_comparison') IS NOT NULL THEN
    EXECUTE $comment$COMMENT ON VIEW public.vw_source_comparison IS 'Real acquisition source comparison for reports. Enforced as security_invoker to preserve caller RLS.'$comment$;
  END IF;

  IF to_regclass('public.vw_acquisition_channel_daily') IS NOT NULL THEN
    EXECUTE $comment$COMMENT ON VIEW public.vw_acquisition_channel_daily IS 'Daily acquisition channel rollup. Enforced as security_invoker to preserve caller RLS.'$comment$;
  END IF;
END $$;
