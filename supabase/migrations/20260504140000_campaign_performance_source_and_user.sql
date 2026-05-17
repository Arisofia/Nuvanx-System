-- Migration: add user_id + source to vw_campaign_performance_real
-- This allows per-user isolation and source-level attribution in the Attribution tab.

DO $$
BEGIN
  IF to_regclass('public.leads') IS NULL THEN
    RAISE NOTICE 'Skipping vw_campaign_performance_real refresh: public.leads does not exist';
    RETURN;
  END IF;

  EXECUTE $sql$
    -- Drop previous version to avoid column rename/reorder errors on deploy
    DROP VIEW IF EXISTS public.vw_campaign_performance_real;

    CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
    SELECT
      l.user_id,
      NULL::TEXT AS source,
      COALESCE(l.campaign_name, 'Organic / Unknown')  AS campaign_name,
      l.campaign_id,
      COUNT(*)                                         AS total_leads,
      COUNT(*) FILTER (WHERE l.first_outbound_at IS NOT NULL)                            AS contacted,
      COUNT(*) FILTER (WHERE l.first_inbound_at  IS NOT NULL)                            AS replied,
      COUNT(*) FILTER (WHERE l.appointment_status IN ('scheduled','confirmed','showed'))  AS booked,
      COUNT(*) FILTER (WHERE l.appointment_status = 'showed')                            AS attended,
      COUNT(*) FILTER (WHERE l.no_show_flag = TRUE)                                      AS no_shows,
      0::BIGINT                                         AS closed,
      COUNT(*) FILTER (WHERE l.verified_revenue > 0)                                     AS closed_won,
      ROUND(COALESCE(SUM(l.revenue), 0), 2)            AS estimated_revenue,
      ROUND(COALESCE(SUM(l.verified_revenue), 0), 2)   AS verified_revenue_crm,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE l.first_inbound_at IS NOT NULL) /
        NULLIF(COUNT(*) FILTER (WHERE l.first_outbound_at IS NOT NULL), 0), 1
      ) AS reply_rate_pct,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE l.appointment_status IN ('scheduled','confirmed','showed')) /
        NULLIF(COUNT(*) FILTER (WHERE l.first_inbound_at IS NOT NULL), 0), 1
      ) AS replied_to_booked_pct,
      ROUND(
        0.0, 1
      ) AS lead_to_close_rate_pct,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE l.no_show_flag = TRUE) /
        NULLIF(COUNT(*) FILTER (WHERE l.appointment_status IS NOT NULL), 0), 1
      ) AS no_show_rate_pct,
      ROUND(AVG(l.reply_delay_minutes), 1)             AS avg_reply_delay_min,
      NULL::TIMESTAMPTZ                               AS first_lead_at,
      NULL::TIMESTAMPTZ                               AS last_lead_at
    FROM public.leads l
    GROUP BY l.user_id, l.campaign_name, l.campaign_id;

    -- Preserve permissions
    GRANT SELECT ON public.vw_campaign_performance_real TO service_role;
  $sql$;
END $$;
