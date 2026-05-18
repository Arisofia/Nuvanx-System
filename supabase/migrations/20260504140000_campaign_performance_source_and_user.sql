-- Migration: add user_id + source to vw_campaign_performance_real
-- This allows per-user isolation and source-level attribution in the Attribution tab.

-- Drop previous version to avoid column rename/reorder errors on deploy.
DROP VIEW IF EXISTS public.vw_campaign_performance_real CASCADE;

DO $$
BEGIN
  IF to_regclass('public.leads') IS NULL THEN
    RAISE NOTICE 'Creating empty vw_campaign_performance_real placeholder: public.leads does not exist yet';

    CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
    SELECT
      NULL::UUID        AS user_id,
      NULL::TEXT        AS source,
      NULL::TEXT        AS campaign_name,
      NULL::TEXT        AS campaign_id,
      0::BIGINT         AS total_leads,
      0::BIGINT         AS contacted,
      0::BIGINT         AS replied,
      0::BIGINT         AS booked,
      0::BIGINT         AS attended,
      0::BIGINT         AS no_shows,
      0::BIGINT         AS closed,
      0::BIGINT         AS closed_won,
      0::NUMERIC        AS estimated_revenue,
      0::NUMERIC        AS verified_revenue_crm,
      NULL::NUMERIC     AS reply_rate_pct,
      NULL::NUMERIC     AS replied_to_booked_pct,
      0.0::NUMERIC      AS lead_to_close_rate_pct,
      NULL::NUMERIC     AS no_show_rate_pct,
      0::NUMERIC        AS avg_reply_delay_min,
      NULL::TIMESTAMPTZ AS first_lead_at,
      NULL::TIMESTAMPTZ AS last_lead_at
    WHERE FALSE;
  ELSE
    CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
    SELECT
      l.user_id,
      NULL::TEXT AS source,
      COALESCE(l.campaign_name, 'Organic / Unknown') AS campaign_name,
      l.campaign_id,
      COUNT(*) AS total_leads,
      COUNT(*) FILTER (WHERE l.first_outbound_at IS NOT NULL) AS contacted,
      COUNT(*) FILTER (WHERE l.first_inbound_at IS NOT NULL) AS replied,
      COUNT(*) FILTER (WHERE l.appointment_status IN ('scheduled', 'confirmed', 'showed')) AS booked,
      COUNT(*) FILTER (WHERE l.appointment_status = 'showed') AS attended,
      COUNT(*) FILTER (WHERE l.no_show_flag = TRUE) AS no_shows,
      0::BIGINT AS closed,
      COUNT(*) FILTER (WHERE l.verified_revenue > 0) AS closed_won,
      ROUND(COALESCE(SUM(l.revenue), 0)::NUMERIC, 2) AS estimated_revenue,
      ROUND(COALESCE(SUM(l.verified_revenue), 0)::NUMERIC, 2) AS verified_revenue_crm,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE l.first_inbound_at IS NOT NULL) /
        NULLIF(COUNT(*) FILTER (WHERE l.first_outbound_at IS NOT NULL), 0), 1
      ) AS reply_rate_pct,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE l.appointment_status IN ('scheduled', 'confirmed', 'showed')) /
        NULLIF(COUNT(*) FILTER (WHERE l.first_inbound_at IS NOT NULL), 0), 1
      ) AS replied_to_booked_pct,
      0.0::NUMERIC AS lead_to_close_rate_pct,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE l.no_show_flag = TRUE) /
        NULLIF(COUNT(*) FILTER (WHERE l.appointment_status IS NOT NULL), 0), 1
      ) AS no_show_rate_pct,
      ROUND(COALESCE(AVG(l.reply_delay_minutes), 0)::NUMERIC, 1) AS avg_reply_delay_min,
      MIN(l.created_at) AS first_lead_at,
      MAX(l.created_at) AS last_lead_at
    FROM public.leads l
    GROUP BY
      l.user_id,
      l.campaign_name,
      l.campaign_id;
  END IF;
END $$;

-- Preserve permissions
GRANT SELECT ON public.vw_campaign_performance_real TO service_role;
