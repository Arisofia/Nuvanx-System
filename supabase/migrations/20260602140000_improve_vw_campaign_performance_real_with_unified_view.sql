-- =============================================================================
-- Improve vw_campaign_performance_real:
--   - Base the view on vw_doctoralia_lead_traceability_unified + meta_attribution
--   - Pull real source / campaign data when available
--   - Use lead_stage + appointment fields for funnel stages
--   - Provide better (still partial) calculations for rates
--   - Document remaining gaps (contacted/replied from WhatsApp, etc.)
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.vw_doctoralia_lead_traceability_unified') IS NULL THEN
    RAISE NOTICE 'Skipping vw_campaign_performance_real improvement: vw_doctoralia_lead_traceability_unified does not exist yet';
    RETURN;
  END IF;

  -- View recreation moved to 20260604000000_final_vw_campaign_performance_real.sql
  -- DROP VIEW IF EXISTS public.vw_campaign_performance_real; -- disabled to avoid conflicts

  EXECUTE '
  CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
  SELECT
    l.user_id                           AS user_id,
    COALESCE(ma.campaign_name, l.campaign_name, ''Organic / Unknown'') AS campaign_name,
    COALESCE(ma.campaign_id, l.campaign_id)             AS campaign_id,
    COALESCE(ma.adset_name, l.adset_name)               AS adset_name,
    COALESCE(ma.adset_id, l.adset_id)                   AS adset_id,
    COALESCE(ma.ad_name, l.ad_name)                     AS ad_name,
    COALESCE(ma.ad_id, l.ad_id)                         AS ad_id,

    COUNT(*)                                            AS total_leads,

    -- TODO: Replace with real ''contacted'' count from whatsapp_conversations or leads.stage
    0::BIGINT                                           AS contacted,

    -- TODO: Replace with real ''replied'' count from whatsapp_conversations
    0::BIGINT                                           AS replied,

    COUNT(*) FILTER (WHERE COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IN (''scheduled'',''confirmed'',''showed'',''completed'')) AS booked,

    COUNT(*) FILTER (WHERE COALESCE(ut.attended_at, l.attended_at) IS NOT NULL
                      OR COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IN (''showed'',''completed'')) AS attended,

    COUNT(*) FILTER (WHERE COALESCE(ut.no_show_flag, l.no_show_flag) = TRUE) AS no_shows,

    -- TODO: Real ''closed'' from financial_settlements or stage
    0::BIGINT                                           AS closed,

    COUNT(*) FILTER (WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue) > 0) AS closed_won,

    ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_estimated, l.revenue)), 0), 2) AS estimated_revenue,
    ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_verified, l.verified_revenue)), 0), 2) AS verified_revenue_crm,

    -- TODO: Real reply rate from whatsapp_conversations
    NULL::NUMERIC                                       AS reply_rate_pct,

    NULL::NUMERIC                                       AS replied_to_booked_pct,

    ROUND(
      100.0 * COUNT(*) FILTER (WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue) > 0) /
      NULLIF(COUNT(*), 0), 1
    )                                                   AS lead_to_close_rate_pct,

    ROUND(
      100.0 * COUNT(*) FILTER (WHERE COALESCE(ut.no_show_flag, l.no_show_flag) = TRUE) /
      NULLIF(COUNT(*) FILTER (WHERE COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IS NOT NULL), 0), 1
    )                                                   AS no_show_rate_pct,

    -- TODO: Real average reply delay from whatsapp_conversations
    NULL::NUMERIC                                       AS avg_reply_delay_min,

    MIN(COALESCE(ut.lead_created_at, l.created_at))     AS first_lead_at,
    MAX(COALESCE(ut.lead_created_at, l.created_at))     AS last_lead_at

  FROM public.leads l
  LEFT JOIN public.vw_doctoralia_lead_traceability_unified ut
    ON ut.lead_id = l.id
  LEFT JOIN public.meta_attribution ma
    ON ma.lead_id = l.id
  GROUP BY
    l.user_id,
    COALESCE(ma.campaign_name, l.campaign_name, ''Organic / Unknown''),
    COALESCE(ma.campaign_id, l.campaign_id),
    COALESCE(ma.adset_name, l.adset_name),
    COALESCE(ma.adset_id, l.adset_id),
    COALESCE(ma.ad_name, l.ad_name),
    COALESCE(ma.ad_id, l.ad_id)';

  EXECUTE 'ALTER VIEW public.vw_campaign_performance_real SET (security_invoker = true)';
  EXECUTE 'GRANT SELECT ON public.vw_campaign_performance_real TO service_role';
  EXECUTE 'GRANT SELECT ON public.vw_campaign_performance_real TO authenticated';

  EXECUTE 'COMMENT ON VIEW public.vw_campaign_performance_real IS
    ''Real campaign performance metrics. Currently partially enriched via vw_doctoralia_lead_traceability_unified + meta_attribution. ''
    ''Several funnel columns (contacted, replied, reply_rate_pct, etc.) are still placeholders pending WhatsApp + full attribution data.''';

END $$ LANGUAGE plpgsql;
