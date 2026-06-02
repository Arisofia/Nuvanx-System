-- =============================================================================
-- FINAL canonical version of vw_campaign_performance_real
-- Date: 2026-06-04
--
-- This is the single source of truth for the view.
-- All previous attempts to define this view in earlier June migrations
-- are now superseded by this file.
--
-- Strategy:
-- - Join through leads (which has user_id) → unified view on lead_id
-- - Include WhatsApp enrichment when available
-- - Keep security_invoker = true
-- =============================================================================

DO $$
BEGIN
  -- Only proceed if the required base objects exist
  IF to_regclass('public.leads') IS NULL THEN
    RETURN;
  END IF;

  DROP VIEW IF EXISTS public.vw_campaign_performance_real;

  -- We use a safe version that works with the current state of
  -- vw_doctoralia_lead_traceability_unified (which may or may not have WhatsApp columns yet)
  EXECUTE '
  CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
  SELECT
    COALESCE(u.id, l.user_id)                           AS user_id,
    COALESCE(ma.campaign_name, l.campaign_name, ''Organic / Unknown'') AS campaign_name,
    COALESCE(ma.campaign_id, l.campaign_id)             AS campaign_id,

    COUNT(*)                                            AS total_leads,

    COUNT(*) FILTER (WHERE COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) 
                     IN (''scheduled'',''confirmed'',''showed'',''completed'')) AS booked,

    COUNT(*) FILTER (WHERE COALESCE(ut.attended_at, l.attended_at) IS NOT NULL
                      OR COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) 
                         IN (''showed'',''completed'')) AS attended,

    COUNT(*) FILTER (WHERE COALESCE(ut.no_show_flag, l.no_show_flag) = TRUE) AS no_shows,

    COUNT(*) FILTER (WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue) > 0) AS closed,

    ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_estimated, l.revenue)), 0), 2) AS estimated_revenue,
    ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_verified, l.verified_revenue)), 0), 2) AS verified_revenue_crm,

    ROUND(
      100.0 * COUNT(*) FILTER (WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue) > 0) /
      NULLIF(COUNT(*), 0), 1
    )                                                   AS lead_to_close_rate_pct,

    ROUND(
      100.0 * COUNT(*) FILTER (WHERE COALESCE(ut.no_show_flag, l.no_show_flag) = TRUE) /
      NULLIF(COUNT(*) FILTER (WHERE COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IS NOT NULL), 0), 1
    )                                                   AS no_show_rate_pct,

    MIN(COALESCE(ut.lead_created_at, l.created_at))     AS first_lead_at,
    MAX(COALESCE(ut.lead_created_at, l.created_at))     AS last_lead_at

  FROM public.leads l
  LEFT JOIN public.vw_doctoralia_lead_traceability_unified ut
    ON ut.lead_id = l.id
  LEFT JOIN public.meta_attribution ma
    ON ma.lead_id = l.id
  LEFT JOIN public.users u
    ON u.id = l.user_id
  GROUP BY
    COALESCE(u.id, l.user_id),
    COALESCE(ma.campaign_name, l.campaign_name, ''Organic / Unknown''),
    COALESCE(ma.campaign_id, l.campaign_id)';

  EXECUTE 'ALTER VIEW public.vw_campaign_performance_real SET (security_invoker = true)';
  EXECUTE 'GRANT SELECT ON public.vw_campaign_performance_real TO service_role';
  EXECUTE 'GRANT SELECT ON public.vw_campaign_performance_real TO authenticated';
END $$;

COMMENT ON VIEW public.vw_campaign_performance_real IS
  'Final canonical campaign performance view. Joins via leads for proper user/clinic scoping. Supersedes all previous definitions.';
