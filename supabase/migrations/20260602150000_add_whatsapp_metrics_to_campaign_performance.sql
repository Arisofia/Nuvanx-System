-- =============================================================================
-- Next iteration of vw_campaign_performance_real:
-- Adds real WhatsApp-based metrics (contacted, replied, reply_rate, avg reply delay)
-- by joining whatsapp_conversations.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.whatsapp_conversations') IS NULL THEN
    RAISE NOTICE 'Skipping WhatsApp metrics enrichment: whatsapp_conversations table does not exist yet';
    RETURN;
  END IF;

  -- View recreation moved to 20260604000000_final_vw_campaign_performance_real.sql
  -- DROP VIEW IF EXISTS public.vw_campaign_performance_real; -- disabled to avoid conflicts

  EXECUTE '
  CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
  WITH whatsapp_stats AS (
    SELECT
      wc.lead_id,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(wc.direction, '''')) <> ''inbound'') > 0 AS has_outbound,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(wc.direction, '''')) = ''inbound'') > 0   AS has_inbound,
      MIN(wc.sent_at) FILTER (WHERE LOWER(COALESCE(wc.direction, '''')) <> ''inbound'') AS first_outbound_at,
      MIN(wc.sent_at) FILTER (WHERE LOWER(COALESCE(wc.direction, '''')) = ''inbound'')   AS first_inbound_at,
      AVG(
        EXTRACT(EPOCH FROM (wc.sent_at - prev.sent_at)) / 60
      ) FILTER (WHERE LOWER(COALESCE(wc.direction, '''')) = ''inbound'' AND prev.sent_at IS NOT NULL) AS avg_reply_delay_minutes
    FROM public.whatsapp_conversations wc
    LEFT JOIN LATERAL (
      SELECT sent_at
      FROM public.whatsapp_conversations prev
      WHERE prev.lead_id = wc.lead_id
        AND prev.sent_at < wc.sent_at
      ORDER BY prev.sent_at DESC
      LIMIT 1
    ) prev ON true
    GROUP BY wc.lead_id
  )
  SELECT
    COALESCE(u.id, l.user_id)                           AS user_id,
    COALESCE(ma.campaign_name, l.campaign_name, ''Organic / Unknown'') AS campaign_name,
    COALESCE(ma.campaign_id, l.campaign_id)             AS campaign_id,
    COALESCE(ma.adset_name, l.adset_name)               AS adset_name,
    COALESCE(ma.adset_id, l.adset_id)                   AS adset_id,
    COALESCE(ma.ad_name, l.ad_name)                     AS ad_name,
    COALESCE(ma.ad_id, l.ad_id)                         AS ad_id,

    COUNT(*)                                            AS total_leads,

    -- Real WhatsApp metrics
    COUNT(*) FILTER (WHERE ws.has_outbound)             AS contacted,
    COUNT(*) FILTER (WHERE ws.has_inbound)              AS replied,

    COUNT(*) FILTER (WHERE COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IN (''scheduled'',''confirmed'',''showed'',''completed'')) AS booked,

    COUNT(*) FILTER (WHERE COALESCE(ut.attended_at, l.attended_at) IS NOT NULL
                      OR COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IN (''showed'',''completed'')) AS attended,

    COUNT(*) FILTER (WHERE COALESCE(ut.no_show_flag, l.no_show_flag) = TRUE) AS no_shows,

    -- TODO: Real closed from financial_settlements when we have better linking
    COUNT(*) FILTER (WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue) > 0) AS closed,

    COUNT(*) FILTER (WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue) > 0) AS closed_won,

    ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_estimated, l.revenue)), 0), 2) AS estimated_revenue,
    ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_verified, l.verified_revenue)), 0), 2) AS verified_revenue_crm,

    -- Real reply rate
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE ws.has_inbound) /
      NULLIF(COUNT(*) FILTER (WHERE ws.has_outbound), 0), 1
    )                                                   AS reply_rate_pct,

    ROUND(
      100.0 * COUNT(*) FILTER (WHERE ws.has_inbound AND COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IN (''scheduled'',''confirmed'',''showed'',''completed'')) /
      NULLIF(COUNT(*) FILTER (WHERE ws.has_inbound), 0), 1
    )                                                   AS replied_to_booked_pct,

    ROUND(
      100.0 * COUNT(*) FILTER (WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue) > 0) /
      NULLIF(COUNT(*), 0), 1
    )                                                   AS lead_to_close_rate_pct,

    ROUND(
      100.0 * COUNT(*) FILTER (WHERE COALESCE(ut.no_show_flag, l.no_show_flag) = TRUE) /
      NULLIF(COUNT(*) FILTER (WHERE COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT) IS NOT NULL), 0), 1
    )                                                   AS no_show_rate_pct,

    ROUND(COALESCE(AVG(ws.avg_reply_delay_minutes), 0), 1) AS avg_reply_delay_min,

    MIN(COALESCE(ut.lead_created_at, l.created_at, ws.first_outbound_at)) AS first_lead_at,
    MAX(COALESCE(ut.lead_created_at, l.created_at, ws.first_outbound_at)) AS last_lead_at

  FROM public.leads l
  LEFT JOIN public.vw_doctoralia_lead_traceability_unified ut
    ON ut.lead_id = l.id
  LEFT JOIN public.meta_attribution ma
    ON ma.lead_id = l.id
  LEFT JOIN public.users u
    ON u.id = l.user_id
  LEFT JOIN whatsapp_stats ws
    ON ws.lead_id = l.id
  GROUP BY
    COALESCE(u.id, l.user_id),
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
    ''Campaign performance with real WhatsApp interaction data (contacted/replied from whatsapp_conversations). ''
    ''Still has some placeholders for closed deals until better financial_settlements linking is in place.''';

END $$ LANGUAGE plpgsql;
