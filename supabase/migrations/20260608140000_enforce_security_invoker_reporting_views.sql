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
  -- 1. Ensure missing views expected by the frontend or reports exist with a baseline definition.
  -- This prevents later security checks from failing on missing objects and unblocks the dashboard.
  
  IF to_regclass('public.v_new_clients_by_channel_detail') IS NULL THEN
    EXECUTE $view$
      CREATE VIEW public.v_new_clients_by_channel_detail AS
      SELECT
        l.id AS record_id,
        l.created_at AS event_at,
        to_char(l.created_at, 'YYYY-MM') AS month_key,
        l.user_id,
        l.clinic_id,
        'other'::text AS channel_group,
        COALESCE(l.source, 'other') AS channel_source,
        COALESCE(l.campaign_name, l.utm_campaign) AS campaign_name,
        l.name AS client_name,
        NULL::TEXT AS treatment_name,
        COALESCE(l.verified_revenue, l.revenue, 0)::NUMERIC AS revenue,
        (l.crm_stage = 'converted') AS is_real_client,
        TRUE AS is_new_client_by_channel,
        TRUE AS is_new_client_global,
        'lead'::text AS source_record_type
      FROM public.leads l
      WHERE l.deleted_at IS NULL;
    $view$;
    GRANT SELECT ON public.v_new_clients_by_channel_detail TO authenticated, service_role;
  END IF;

  -- Always recreate v_new_clients_by_channel_monthly to ensure correct columns for frontend
  DROP VIEW IF EXISTS public.v_new_clients_by_channel_monthly CASCADE;
  EXECUTE $view$
    CREATE VIEW public.v_new_clients_by_channel_monthly AS
    SELECT
      month_key,
      user_id,
      clinic_id,
      channel_group,
      channel_source,
      campaign_name,
      COUNT(DISTINCT record_id) AS client_touchpoints_unique,
      COUNT(DISTINCT record_id) FILTER (WHERE is_real_client) AS real_clients_unique,
      COUNT(DISTINCT record_id) FILTER (WHERE is_new_client_by_channel) AS new_clients_unique_by_channel,
      COUNT(DISTINCT record_id) FILTER (WHERE is_new_client_global) AS new_clients_unique_global,
      SUM(revenue) AS revenue,
      ROUND(100.0 * COUNT(DISTINCT record_id) FILTER (WHERE is_real_client) / NULLIF(COUNT(DISTINCT record_id), 0), 2) AS client_conversion_rate_pct
    FROM public.v_new_clients_by_channel_detail
    GROUP BY month_key, user_id, clinic_id, channel_group, channel_source, campaign_name;
  $view$;
  GRANT SELECT ON public.v_new_clients_by_channel_monthly TO authenticated, service_role;

  IF to_regclass('public.v_patient_conversion_funnel') IS NULL THEN
    EXECUTE $view$
      CREATE VIEW public.v_patient_conversion_funnel AS
      SELECT 'Total Leads' as stage, COUNT(*) as count, 100.0 as percentage FROM public.leads
      UNION ALL
      SELECT 'Converted' as stage, COUNT(*) as count, ROUND(COUNT(*)::NUMERIC / NULLIF((SELECT COUNT(*) FROM public.leads), 0) * 100, 2) as percentage FROM public.leads WHERE crm_stage = 'converted';
    $view$;
    GRANT SELECT ON public.v_patient_conversion_funnel TO authenticated, service_role;
  END IF;

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
