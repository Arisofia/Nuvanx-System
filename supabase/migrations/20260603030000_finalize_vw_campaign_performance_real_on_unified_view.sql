-- =============================================================================
-- Final recommended version of vw_campaign_performance_real
-- Built on top of vw_doctoralia_lead_traceability_unified + meta_attribution
-- Replaces the broken/hardcoded version.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.vw_doctoralia_lead_traceability_unified') IS NULL THEN
    RAISE NOTICE 'Skipping final vw_campaign_performance_real: unified view not present';
    RETURN;
  END IF;

  DROP VIEW IF EXISTS public.vw_campaign_performance_real;

  EXECUTE '
  CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
  SELECT
    u.id                                                AS user_id,
    COALESCE(ma.campaign_name, ut.campaign_name, ''Organic / Unknown'') AS campaign_name,
    COALESCE(ma.campaign_id, ut.campaign_id)            AS campaign_id,

    COUNT(*)                                            AS total_leads,

    -- Real WhatsApp-based metrics (from previous enrichment)
    COUNT(*) FILTER (WHERE ut.has_contacted)            AS contacted,
    COUNT(*) FILTER (WHERE ut.has_replied)              AS replied,

    COUNT(*) FILTER (WHERE ut.lead_stage IN (''scheduled'',''confirmed'',''showed'',''completed'')) AS booked,
    COUNT(*) FILTER (WHERE ut.attended_at IS NOT NULL)  AS attended,
    COUNT(*) FILTER (WHERE ut.no_show_flag = TRUE)      AS no_shows,

    COUNT(*) FILTER (WHERE ut.lead_revenue_verified > 0) AS closed,
    COUNT(*) FILTER (WHERE ut.lead_revenue_verified > 0) AS closed_won,

    ROUND(COALESCE(SUM(ut.lead_revenue_estimated), 0), 2) AS estimated_revenue,
    ROUND(COALESCE(SUM(ut.lead_revenue_verified), 0), 2)  AS verified_revenue_crm,

    ROUND(
      100.0 * COUNT(*) FILTER (WHERE ut.has_replied) /
      NULLIF(COUNT(*) FILTER (WHERE ut.has_contacted), 0), 1
    )                                                   AS reply_rate_pct,

    ROUND(
      100.0 * COUNT(*) FILTER (WHERE ut.has_replied AND ut.lead_stage IN (''scheduled'',''confirmed'',''showed'',''completed'')) /
      NULLIF(COUNT(*) FILTER (WHERE ut.has_replied), 0), 1
    )                                                   AS replied_to_booked_pct,

    ROUND(
      100.0 * COUNT(*) FILTER (WHERE ut.lead_revenue_verified > 0) /
      NULLIF(COUNT(*), 0), 1
    )                                                   AS lead_to_close_rate_pct,

    ROUND(
      100.0 * COUNT(*) FILTER (WHERE ut.no_show_flag = TRUE) /
      NULLIF(COUNT(*) FILTER (WHERE ut.lead_stage IS NOT NULL), 0), 1
    )                                                   AS no_show_rate_pct,

    ROUND(COALESCE(AVG(ut.avg_reply_delay_minutes), 0), 1) AS avg_reply_delay_min,

    MIN(ut.lead_created_at)                             AS first_lead_at,
    MAX(ut.lead_created_at)                             AS last_lead_at

  FROM public.users u
  LEFT JOIN public.vw_doctoralia_lead_traceability_unified ut
    ON ut.user_id = u.id
  LEFT JOIN public.meta_attribution ma
    ON ma.lead_id = ut.lead_id
  GROUP BY
    u.id,
    COALESCE(ma.campaign_name, ut.campaign_name, ''Organic / Unknown''),
    COALESCE(ma.campaign_id, ut.campaign_id)';

  EXECUTE 'ALTER VIEW public.vw_campaign_performance_real SET (security_invoker = true)';
  EXECUTE 'GRANT SELECT ON public.vw_campaign_performance_real TO service_role';
  EXECUTE 'GRANT SELECT ON public.vw_campaign_performance_real TO authenticated';

END $$;

COMMENT ON VIEW public.vw_campaign_performance_real IS
  'Campaign performance view built on the unified traceability layer + meta attribution. '
  'Replaces previous broken/hardcoded implementation.';
