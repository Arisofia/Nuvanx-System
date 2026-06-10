-- Migration: 20260610200000_fix_campaign_booked_metric_alignment.sql
-- Description: Align booked metric in vw_campaign_performance_real with v_figma_kpi_snapshot.
-- This correction ensures that booked counts by campaign match the global booked count.
-- Author: Zencoder
-- Date: 2026-06-10

-- =============================================================================
-- 1. Replace public.vw_campaign_performance_real
-- =============================================================================
-- We drop dependent views first because PostgreSQL does not allow changing 
-- view definitions when they have dependent objects.
DROP VIEW IF EXISTS public.v_figma_campaign_kpis;
DROP VIEW IF EXISTS public.vw_campaign_performance_real;

CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
SELECT
  l.user_id,
  COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::TEXT AS campaign_name,
  COALESCE(ma.campaign_id, l.campaign_id)::TEXT AS campaign_id,
  COALESCE(
    NULLIF(l.utm_source, ''),
    NULLIF(l.source::TEXT, ''),
    CASE WHEN ma.lead_id IS NOT NULL THEN 'meta' ELSE 'unknown' END
  )::TEXT AS source,
  COUNT(*)::BIGINT AS total_leads,
  0::BIGINT AS contacted,
  0::BIGINT AS replied,
  
  -- ALIGNED BOOKED LOGIC:
  -- Counts as booked if there is an appointment date, an appointment status, 
  -- or the lead stage is in any active booking status (including conversions/closed).
  COUNT(*) FILTER (
    WHERE l.appointment_date IS NOT NULL
       OR l.appointment_status IS NOT NULL
       OR COALESCE(ut.lead_stage::TEXT, l.stage::TEXT) IN ('scheduled', 'confirmed', 'showed', 'completed', 'convertido', 'closed')
  )::BIGINT AS booked,
  
  -- ATTENDED LOGIC:
  -- ut.attended_at o l.attended_at no nulo OR appointment_status/lead_stage/stage en showed/completed
  COUNT(*) FILTER (
    WHERE COALESCE(ut.attended_at, l.attended_at) IS NOT NULL
       OR COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT, l.stage::TEXT) IN ('showed', 'completed')
  )::BIGINT AS attended,
  
  -- NO SHOWS:
  COUNT(*) FILTER (
    WHERE COALESCE(ut.no_show_flag, l.no_show_flag, FALSE) = TRUE
       OR COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT, l.stage::TEXT) IN ('no_show', 'no-show', 'noshow')
  )::BIGINT AS no_shows,
  
  -- CLOSED (Revenue > 0 or Closed/Won stage):
  COUNT(*) FILTER (
    WHERE COALESCE(ut.lead_stage::TEXT, l.stage::TEXT) IN ('closed', 'won', 'paid')
       OR COALESCE(ut.lead_revenue_verified, l.verified_revenue, l.revenue, 0) > 0
  )::BIGINT AS closed,
  
  -- CLOSED WON (Verified Revenue > 0):
  COUNT(*) FILTER (
    WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue, 0) > 0
  )::BIGINT AS closed_won,
  
  ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_estimated, l.revenue, 0)), 0), 2)::NUMERIC AS estimated_revenue,
  ROUND(COALESCE(SUM(COALESCE(ut.lead_revenue_verified, l.verified_revenue, 0)), 0), 2)::NUMERIC AS verified_revenue_crm,
  
  NULL::NUMERIC AS reply_rate_pct,
  NULL::NUMERIC AS replied_to_booked_pct,
  
  ROUND(
    100.0 * COUNT(*) FILTER (
      WHERE COALESCE(ut.lead_stage::TEXT, l.stage::TEXT) IN ('closed', 'won', 'paid')
         OR COALESCE(ut.lead_revenue_verified, l.verified_revenue, l.revenue, 0) > 0
    ) / NULLIF(COUNT(*), 0),
    2
  ) AS lead_to_close_rate_pct,
  
  ROUND(
    100.0 * COUNT(*) FILTER (
      WHERE COALESCE(ut.no_show_flag, l.no_show_flag, FALSE) = TRUE
         OR COALESCE(ut.lead_stage::TEXT, l.appointment_status::TEXT, l.stage::TEXT) IN ('no_show', 'no-show', 'noshow')
    ) / NULLIF(COUNT(*), 0),
    2
  ) AS no_show_rate_pct,
  
  NULL::NUMERIC AS avg_reply_delay_min,
  MIN(COALESCE(ut.lead_created_at, l.created_at)) AS first_lead_at,
  MAX(COALESCE(ut.lead_created_at, l.created_at)) AS last_lead_at
  
FROM public.leads l
LEFT JOIN public.vw_doctoralia_lead_traceability_unified ut
  ON ut.lead_id = l.id
LEFT JOIN public.meta_attribution ma
  ON ma.lead_id = l.id
WHERE l.deleted_at IS NULL
GROUP BY
  l.user_id,
  COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::TEXT,
  COALESCE(ma.campaign_id, l.campaign_id)::TEXT,
  COALESCE(
    NULLIF(l.utm_source, ''),
    NULLIF(l.source::TEXT, ''),
    CASE WHEN ma.lead_id IS NOT NULL THEN 'meta' ELSE 'unknown' END
  )::TEXT;

ALTER VIEW public.vw_campaign_performance_real SET (security_invoker = true);
GRANT SELECT ON public.vw_campaign_performance_real TO service_role;
GRANT SELECT ON public.vw_campaign_performance_real TO authenticated;

-- =============================================================================
-- 2. Recreate v_figma_campaign_kpis
-- =============================================================================
CREATE OR REPLACE VIEW public.v_figma_campaign_kpis AS
SELECT
  campaign_name,
  MIN(campaign_id::TEXT) AS campaign_id,
  SUM(total_leads) AS total_leads,
  SUM(booked) AS booked,
  SUM(attended) AS attended,
  SUM(no_shows) AS no_shows,
  SUM(closed) AS closed_won,
  COALESCE(SUM(verified_revenue_crm), 0::NUMERIC) AS verified_revenue,
  ROUND(
    CASE
      WHEN SUM(total_leads) > 0 THEN SUM(booked)::NUMERIC / SUM(total_leads)::NUMERIC * 100::NUMERIC
      ELSE 0::NUMERIC
    END,
    2
  ) AS booking_rate_pct,
  ROUND(
    CASE
      WHEN SUM(total_leads) > 0 THEN SUM(closed)::NUMERIC / SUM(total_leads)::NUMERIC * 100::NUMERIC
      ELSE 0::NUMERIC
    END,
    2
  ) AS close_rate_pct,
  ROUND(
    CASE
      WHEN SUM(booked) > 0 THEN SUM(no_shows)::NUMERIC / SUM(booked)::NUMERIC * 100::NUMERIC
      ELSE 0::NUMERIC
    END,
    2
  ) AS no_show_rate_pct,
  MIN(first_lead_at) AS first_lead_at,
  MAX(last_lead_at) AS last_lead_at
FROM public.vw_campaign_performance_real
WHERE campaign_name IS NOT NULL
GROUP BY campaign_name
ORDER BY SUM(total_leads) DESC;

ALTER VIEW public.v_figma_campaign_kpis SET (security_invoker = true);
GRANT SELECT ON public.v_figma_campaign_kpis TO service_role;
GRANT SELECT ON public.v_figma_campaign_kpis TO authenticated;

-- =============================================================================
-- COMMENT: Aligning booked by campaign with global booked count.
-- =============================================================================
COMMENT ON VIEW public.vw_campaign_performance_real IS
  'Final canonical campaign performance view. Booked metric aligned with v_figma_kpi_snapshot (includes appointment_date IS NOT NULL).';

-- =============================================================================
-- POST-VALIDATION QUERIES (Expected results):
-- =============================================================================
-- SELECT sum(booked) FROM v_figma_campaign_kpis; -- Should be 124
-- SELECT campaign_name, booked FROM v_figma_campaign_kpis WHERE campaign_name ILIKE '%Endolift%'; -- Should be 99
-- SELECT campaign_name, booked FROM v_figma_campaign_kpis WHERE campaign_name ILIKE '%Laser Co2%'; -- Should be 15
-- SELECT campaign_name, booked FROM v_figma_campaign_kpis WHERE campaign_name ILIKE '%Lasérlipolisis%'; -- Should be 10
