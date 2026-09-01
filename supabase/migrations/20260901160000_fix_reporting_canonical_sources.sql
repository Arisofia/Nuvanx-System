-- Canonical reporting repair — 2026-09-01
--
-- Goals:
--   1. Campaign Performance must use the canonical pipeline/journey evidence,
--      not legacy lead.stage / lead.appointment_date fields.
--   2. Source Comparison gets a period-aware, user-scoped RPC so API callers
--      can calculate the requested window instead of filtering an all-time aggregate.
--   3. Campaign ROI must expose verified revenue and only attach spend when a
--      campaign-level canonical spend source exists (Google Ads today). Meta spend
--      remains NULL rather than being fabricated from account-level totals.
--   4. Doctor Performance must use Doctoralia appointment ingestion when doctor_id
--      is available instead of counting only the small legacy leads.doctor_id subset.
--
-- No synthetic leads, patients, appointments, revenue or advertising spend are created.

BEGIN;

-- ---------------------------------------------------------------------------
-- Campaign Performance: preserve the legacy four-argument compatibility
-- signature used by both /reports/campaign-performance and dashboard callers,
-- while rebuilding the metrics from vw_control_centre_pipeline.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_campaign_report(date, date, date, date);

CREATE FUNCTION public.get_campaign_report(
  p_user_id uuid,
  from_date date DEFAULT NULL,
  to_date date DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  campaign_name text,
  campaign_id text,
  source text,
  total_leads bigint,
  contacted bigint,
  replied bigint,
  booked bigint,
  attended bigint,
  no_shows bigint,
  closed bigint,
  closed_won bigint,
  estimated_revenue numeric,
  verified_revenue_crm numeric,
  reply_rate_pct numeric,
  replied_to_booked_pct numeric,
  lead_to_close_rate_pct numeric,
  no_show_rate_pct numeric,
  avg_reply_delay_min numeric,
  first_lead_at timestamptz,
  last_lead_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH params AS (
    SELECT
      COALESCE(from_date, p_from_date, CURRENT_DATE - 30) AS since_date,
      COALESCE(to_date, p_to_date, CURRENT_DATE) AS until_date,
      COALESCE(c.timezone, 'UTC') AS clinic_timezone
    FROM public.users u
    LEFT JOIN public.clinics c ON c.id = u.clinic_id
    WHERE u.id = p_user_id
    LIMIT 1
  ),
  base AS (
    SELECT
      l.id,
      l.created_at,
      l.first_outbound_at,
      l.first_response_at,
      l.first_inbound_at,
      l.reply_delay_minutes,
      l.no_show_flag,
      l.revenue,
      COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::text AS campaign_name,
      COALESCE(ma.campaign_id, l.campaign_id)::text AS campaign_id,
      COALESCE(
        NULLIF(btrim(l.utm_source), ''),
        NULLIF(btrim(l.source::text), ''),
        CASE WHEN ma.lead_id IS NOT NULL THEN 'meta' ELSE 'unknown' END
      )::text AS source_resolved,
      p.journey_appointment_count,
      p.valuation_appointment_date,
      p.is_new_client,
      p.client_completed_at,
      p.verified_revenue
    FROM public.leads l
    JOIN public.vw_control_centre_pipeline p ON p.lead_id = l.id
    LEFT JOIN public.meta_attribution ma ON ma.lead_id = l.id
    CROSS JOIN params x
    WHERE l.user_id = p_user_id
      AND l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
      AND l.created_at >= (x.since_date || ' 00:00:00')::timestamptz AT TIME ZONE x.clinic_timezone
      AND l.created_at < ((x.until_date || ' 00:00:00')::timestamptz + INTERVAL '1 day') AT TIME ZONE x.clinic_timezone
  )
  SELECT
    b.campaign_name,
    b.campaign_id,
    b.source_resolved AS source,
    count(DISTINCT b.id)::bigint AS total_leads,
    count(DISTINCT b.id) FILTER (
      WHERE b.first_outbound_at IS NOT NULL
         OR b.first_response_at IS NOT NULL
         OR b.first_inbound_at IS NOT NULL
    )::bigint AS contacted,
    count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL)::bigint AS replied,
    count(DISTINCT b.id) FILTER (WHERE b.journey_appointment_count >= 1)::bigint AS booked,
    count(DISTINCT b.id) FILTER (
      WHERE b.valuation_appointment_date IS NOT NULL
        AND (
          lower(btrim(COALESCE(p.appointment_status, ''))) IN ('pagada', 'realizada', 'showed', 'completed')
          OR b.is_new_client = true
        )
    )::bigint AS attended,
    count(DISTINCT b.id) FILTER (WHERE COALESCE(b.no_show_flag, false))::bigint AS no_shows,
    count(DISTINCT b.id) FILTER (WHERE b.is_new_client)::bigint AS closed,
    count(DISTINCT b.id) FILTER (
      WHERE b.client_completed_at IS NOT NULL OR COALESCE(b.verified_revenue, 0) > 0
    )::bigint AS closed_won,
    round(COALESCE(sum(COALESCE(b.revenue, 0)), 0), 2) AS estimated_revenue,
    round(COALESCE(sum(COALESCE(b.verified_revenue, 0)), 0), 2) AS verified_revenue_crm,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL)::numeric
      / NULLIF(count(DISTINCT b.id) FILTER (
          WHERE b.first_outbound_at IS NOT NULL
             OR b.first_response_at IS NOT NULL
             OR b.first_inbound_at IS NOT NULL
        ), 0)::numeric,
      2
    ) AS reply_rate_pct,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.journey_appointment_count >= 1)::numeric
      / NULLIF(count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL), 0)::numeric,
      2
    ) AS replied_to_booked_pct,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.is_new_client)::numeric
      / NULLIF(count(DISTINCT b.id), 0)::numeric,
      2
    ) AS lead_to_close_rate_pct,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE COALESCE(b.no_show_flag, false))::numeric
      / NULLIF(count(DISTINCT b.id), 0)::numeric,
      2
    ) AS no_show_rate_pct,
    round(avg(b.reply_delay_minutes) FILTER (WHERE b.reply_delay_minutes IS NOT NULL)::numeric, 1) AS avg_reply_delay_min,
    min(b.created_at) AS first_lead_at,
    max(b.created_at) AS last_lead_at
  FROM base b
  GROUP BY b.campaign_name, b.campaign_id, b.source_resolved
  ORDER BY total_leads DESC, verified_revenue_crm DESC, last_lead_at DESC;
$$;

-- ---------------------------------------------------------------------------
-- Source Comparison: period-aware + tenant-aware canonical RPC.
-- The existing view is retained for backwards compatibility, but report APIs
-- should move to this function so arbitrary date filters recalculate metrics.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_source_comparison(uuid, text, text);

CREATE FUNCTION public.get_source_comparison(
  p_user_id uuid,
  p_from text DEFAULT '',
  p_to text DEFAULT ''
)
RETURNS TABLE (
  user_id uuid,
  clinic_id uuid,
  source text,
  source_label text,
  channel_group text,
  total_leads bigint,
  contacted bigint,
  replied bigint,
  booked bigint,
  closed bigint,
  reply_rate_pct numeric,
  replied_to_booked_pct numeric,
  lead_to_close_rate_pct numeric,
  avg_reply_delay_min numeric,
  verified_revenue_crm numeric,
  first_lead_at timestamptz,
  last_lead_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH base AS (
    SELECT
      l.id,
      l.user_id,
      l.clinic_id,
      COALESCE(NULLIF(btrim(l.utm_source), ''), NULLIF(btrim(l.source::text), ''), 'unknown')::text AS source_resolved,
      l.created_at,
      l.first_outbound_at,
      l.first_response_at,
      l.first_inbound_at,
      l.reply_delay_minutes,
      p.journey_appointment_count,
      p.is_new_client,
      p.verified_revenue
    FROM public.leads l
    JOIN public.vw_control_centre_pipeline p ON p.lead_id = l.id
    WHERE l.user_id = p_user_id
      AND l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND (p_from = '' OR l.created_at >= (p_from || ' 00:00:00')::timestamptz AT TIME ZONE params.clinic_timezone)
      AND (p_to = '' OR l.created_at < ((p_to || ' 00:00:00')::timestamptz + INTERVAL '1 day') AT TIME ZONE params.clinic_timezone)
  )
  SELECT
    b.user_id,
    b.clinic_id,
    b.source_resolved AS source,
    CASE
      WHEN b.source_resolved IN ('meta', 'meta_leadgen', 'facebook', 'instagram') THEN 'Meta Lead Ads'
      WHEN b.source_resolved = 'doctoralia_marketing' THEN 'Doctoralia Marketing'
      WHEN b.source_resolved = 'doctoralia' THEN 'Doctoralia'
      WHEN b.source_resolved IN ('google', 'google_ads', 'googleads', 'adwords', 'cpc') THEN 'Google Ads'
      ELSE initcap(replace(b.source_resolved, '_', ' '))
    END::text AS source_label,
    CASE
      WHEN b.source_resolved IN ('meta', 'meta_leadgen', 'facebook', 'instagram') THEN 'social'
      WHEN b.source_resolved IN ('google', 'google_ads', 'googleads', 'adwords', 'cpc') THEN 'search'
      WHEN b.source_resolved LIKE 'doctoralia%' THEN 'marketplace'
      ELSE 'other'
    END::text AS channel_group,
    count(DISTINCT b.id)::bigint AS total_leads,
    count(DISTINCT b.id) FILTER (
      WHERE b.first_outbound_at IS NOT NULL
         OR b.first_response_at IS NOT NULL
         OR b.first_inbound_at IS NOT NULL
    )::bigint AS contacted,
    count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL)::bigint AS replied,
    count(DISTINCT b.id) FILTER (WHERE b.journey_appointment_count >= 1)::bigint AS booked,
    count(DISTINCT b.id) FILTER (WHERE b.is_new_client)::bigint AS closed,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL)::numeric
      / NULLIF(count(DISTINCT b.id) FILTER (
          WHERE b.first_outbound_at IS NOT NULL
             OR b.first_response_at IS NOT NULL
             OR b.first_inbound_at IS NOT NULL
        ), 0)::numeric,
      2
    ) AS reply_rate_pct,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.journey_appointment_count >= 1)::numeric
      / NULLIF(count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL), 0)::numeric,
      2
    ) AS replied_to_booked_pct,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.is_new_client)::numeric
      / NULLIF(count(DISTINCT b.id), 0)::numeric,
      2
    ) AS lead_to_close_rate_pct,
    round(avg(b.reply_delay_minutes) FILTER (WHERE b.reply_delay_minutes IS NOT NULL)::numeric, 1) AS avg_reply_delay_min,
    round(COALESCE(sum(COALESCE(b.verified_revenue, 0)), 0), 2) AS verified_revenue_crm,
    min(b.created_at) AS first_lead_at,
    max(b.created_at) AS last_lead_at
  FROM base b
  GROUP BY b.user_id, b.clinic_id, b.source_resolved
  ORDER BY total_leads DESC, verified_revenue_crm DESC;
$$;

-- ---------------------------------------------------------------------------
-- Campaign ROI: verified lead-level revenue + provable campaign-level spend.
-- Google Ads has canonical campaign/day spend. Meta currently has only account/day
-- persistence, so Meta campaign spend is intentionally NULL until campaign-level
-- ingestion exists. This prevents invented ROI/CAC.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_campaign_roi(uuid, text, text, text);

CREATE FUNCTION public.get_campaign_roi(
  p_user_id uuid,
  p_from text DEFAULT '',
  p_to text DEFAULT '',
  p_source text DEFAULT ''
)
RETURNS TABLE (
  campaign_name text,
  source text,
  month text,
  leads_count bigint,
  patients_count bigint,
  net_revenue numeric,
  spend numeric,
  cac numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH user_clinic AS (
    SELECT 
      u.id AS user_id,
      c.timezone AS clinic_timezone
    FROM public.users u
    JOIN public.clinics c ON c.id = u.clinic_id
    WHERE u.id = p_user_id
  ),
  lead_base AS (
    SELECT
      l.id AS lead_id,
      COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::text AS campaign_name,
      COALESCE(ma.campaign_id, l.campaign_id)::text AS campaign_id,
      COALESCE(NULLIF(btrim(l.utm_source), ''), NULLIF(btrim(l.source::text), ''), 'unknown')::text AS source,
      date_trunc('month', l.created_at)::date AS month_date,
      p.is_new_client,
      COALESCE(p.verified_revenue, 0)::numeric AS verified_revenue
    FROM public.leads l
    JOIN public.vw_control_centre_pipeline p ON p.lead_id = l.id
    LEFT JOIN public.meta_attribution ma ON ma.lead_id = l.id
    CROSS JOIN user_clinic uc
    WHERE l.user_id = p_user_id
      AND l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
      AND (p_from = '' OR l.created_at >= (p_from || ' 00:00:00')::timestamptz AT TIME ZONE uc.clinic_timezone)
      AND (p_to = '' OR l.created_at < ((p_to || ' 00:00:00')::timestamptz + INTERVAL '1 day') AT TIME ZONE uc.clinic_timezone)
      AND (
        p_source = ''
        OR COALESCE(NULLIF(btrim(l.utm_source), ''), NULLIF(btrim(l.source::text), ''), 'unknown') = p_source
      )
  ),
  lead_rollup AS (
    SELECT
      b.campaign_name,
      b.campaign_id,
      b.source,
      b.source_category,
      b.month_date,
      count(DISTINCT b.lead_id)::bigint AS leads_count,
      count(DISTINCT b.lead_id) FILTER (WHERE b.is_new_client)::bigint AS patients_count,
      round(COALESCE(sum(b.verified_revenue), 0), 2) AS net_revenue
    FROM lead_base_with_source b
    GROUP BY b.campaign_name, b.campaign_id, b.source, b.source_category, b.month_date
  ),
  google_spend AS (
    SELECT
      g.campaign_id::text AS campaign_id,
      date_trunc('month', g.date)::date AS month_date,
      round(sum(COALESCE(g.spend, 0)), 2) AS spend
    FROM public.google_ads_daily_insights g
    WHERE g.user_id = p_user_id
      AND (p_from = '' OR g.date >= p_from::date)
      AND (p_to = '' OR g.date <= p_to::date)
    GROUP BY g.campaign_id, date_trunc('month', g.date)::date
  ),
  lead_base_with_source AS (
    SELECT
      lb.*,
      CASE
        WHEN lb.source IN ('google', 'google_ads', 'googleads', 'adwords', 'cpc') THEN 'google'
        ELSE 'other'
      END AS source_category
    FROM lead_base lb
  )
  SELECT
    r.campaign_name,
    r.source,
    to_char(r.month_date, 'YYYY-MM') AS month,
    r.leads_count,
    r.patients_count,
    r.net_revenue,
    CASE
      WHEN r.campaign_id IS NOT NULL AND gs.campaign_id IS NOT NULL AND r.source_category = 'google' THEN gs.spend
      ELSE NULL::numeric
    END AS spend,
    CASE
      WHEN r.campaign_id IS NOT NULL
       AND gs.campaign_id IS NOT NULL
       AND r.source_category = 'google'
       AND r.patients_count > 0
      THEN round(gs.spend / r.patients_count::numeric, 2)
      ELSE NULL::numeric
    END AS cac
  FROM lead_rollup r
  LEFT JOIN google_spend gs
    ON gs.campaign_id = r.campaign_id
   AND gs.month_date = r.month_date
  ORDER BY r.month_date DESC, r.leads_count DESC, r.campaign_name;
$$;

-- ---------------------------------------------------------------------------
-- Doctor Performance: Doctoralia ingestion already owns doctor_id for clinical
-- agendas. Prefer that evidence; retain lead/revenue fallback for doctors that do
-- not yet have Doctoralia-attributed appointments.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_doctor_performance_real AS
WITH doctoralia_agg AS (
  SELECT
    a.doctor_id,
    count(*)::bigint AS total_appointments,
    count(*) FILTER (
      WHERE lower(btrim(COALESCE(NULLIF(a.status, ''), NULLIF(a.estado, ''), ''))) IN ('pagada', 'realizada', 'showed', 'completed')
    )::bigint AS attended_count,
    count(*) FILTER (
      WHERE lower(btrim(COALESCE(NULLIF(a.status, ''), NULLIF(a.estado, ''), ''))) IN ('no acude', 'no acudió', 'no acudio', 'no_show', 'no show', 'noshow')
    )::bigint AS no_show_count,
    count(*) FILTER (
      WHERE COALESCE(a.is_cancelled, false)
         OR lower(btrim(COALESCE(NULLIF(a.status, ''), NULLIF(a.estado, ''), ''))) IN ('anulada', 'anulado', 'cancelada', 'cancelado', 'cancelled', 'canceled')
    )::bigint AS cancelled_count,
    count(*) FILTER (
      WHERE a.appointment_date IS NOT NULL
        AND NOT COALESCE(a.is_cancelled, false)
        AND lower(btrim(COALESCE(NULLIF(a.status, ''), NULLIF(a.estado, ''), ''))) NOT IN ('anulada', 'anulado', 'cancelada', 'cancelado', 'cancelled', 'canceled', 'no acude', 'no acudió', 'no acudio', 'no_show', 'no show', 'noshow')
    )::bigint AS confirmed_count,
    round(COALESCE(sum(COALESCE(a.amount, 0)) FILTER (
      WHERE NOT COALESCE(a.is_cancelled, false)
        AND lower(btrim(COALESCE(NULLIF(a.status, ''), NULLIF(a.estado, ''), ''))) NOT IN ('anulada', 'anulado', 'cancelada', 'cancelado', 'cancelled', 'canceled', 'no acude', 'no acudió', 'no acudio', 'no_show', 'no show', 'noshow')
    ), 0), 2) AS estimated_revenue
  FROM public.doctoralia_appointments_ingestion a
  WHERE a.doctor_id IS NOT NULL
  GROUP BY a.doctor_id
),
lead_agg AS (
  SELECT
    l.doctor_id,
    count(l.id)::bigint AS total_appointments,
    count(l.id) FILTER (WHERE l.attended_at IS NOT NULL OR l.appointment_status = 'showed'::public.appointment_status)::bigint AS attended_count,
    count(l.id) FILTER (WHERE COALESCE(l.no_show_flag, false))::bigint AS no_show_count,
    count(l.id) FILTER (WHERE l.appointment_status = 'cancelled'::public.appointment_status)::bigint AS cancelled_count,
    count(l.id) FILTER (WHERE l.appointment_date IS NOT NULL)::bigint AS confirmed_count,
    round(COALESCE(sum(COALESCE(l.revenue, 0)) FILTER (WHERE COALESCE(l.revenue, 0) > 0), 0), 2) AS estimated_revenue
  FROM public.leads l
  WHERE l.doctor_id IS NOT NULL
    AND l.deleted_at IS NULL
    AND l.merged_into_lead_id IS NULL
  GROUP BY l.doctor_id
),
doctor_settlements AS (
  SELECT
    l.doctor_id,
    round(COALESCE(sum(fs.amount_net) FILTER (WHERE fs.cancelled_at IS NULL), 0), 2) AS verified_revenue
  FROM public.leads l
  JOIN public.financial_settlements fs ON fs.patient_id = l.converted_patient_id
  WHERE l.doctor_id IS NOT NULL
    AND l.deleted_at IS NULL
    AND l.merged_into_lead_id IS NULL
  GROUP BY l.doctor_id
),
combined AS (
  SELECT
    d.id AS doctor_id,
    d.name AS doctor_name,
    d.specialty,
    d.is_active,
    d.clinic_id,
    COALESCE(da.total_appointments, la.total_appointments, 0)::bigint AS total_appointments,
    COALESCE(da.attended_count, la.attended_count, 0)::bigint AS attended_count,
    COALESCE(da.no_show_count, la.no_show_count, 0)::bigint AS no_show_count,
    COALESCE(da.cancelled_count, la.cancelled_count, 0)::bigint AS cancelled_count,
    COALESCE(da.confirmed_count, la.confirmed_count, 0)::bigint AS confirmed_count,
    COALESCE(da.estimated_revenue, la.estimated_revenue, 0)::numeric AS estimated_revenue,
    COALESCE(ds.verified_revenue, 0)::numeric AS verified_revenue_crm
  FROM public.doctors d
  LEFT JOIN doctoralia_agg da ON da.doctor_id = d.id
  LEFT JOIN lead_agg la ON la.doctor_id = d.id
  LEFT JOIN doctor_settlements ds ON ds.doctor_id = d.id
)
SELECT
  c.doctor_id,
  c.doctor_name,
  c.specialty,
  c.is_active,
  c.clinic_id,
  c.total_appointments,
  c.attended_count,
  c.no_show_count,
  c.cancelled_count,
  c.confirmed_count,
  round(
    CASE WHEN c.total_appointments > 0
      THEN 100.0 * c.attended_count::numeric / c.total_appointments::numeric
      ELSE 0::numeric END,
    2
  ) AS attended_rate_pct,
  round(
    CASE WHEN c.total_appointments > 0
      THEN 100.0 * c.no_show_count::numeric / c.total_appointments::numeric
      ELSE 0::numeric END,
    2
  ) AS no_show_rate_pct,
  c.estimated_revenue,
  c.verified_revenue_crm
FROM combined c;

COMMENT ON FUNCTION public.get_campaign_report(date, date, date, date) IS
  'Canonical period-aware campaign performance from active leads + vw_control_centre_pipeline. Legacy four-date signature retained for API compatibility.';

COMMENT ON FUNCTION public.get_source_comparison(uuid, text, text) IS
  'Tenant-scoped, period-aware source performance. Intended reporting SSOT; API must call this RPC rather than date-filtering the all-time vw_source_comparison aggregate.';

COMMENT ON FUNCTION public.get_campaign_roi(uuid, text, text, text) IS
  'Campaign ROI with verified lead-level revenue and only provable campaign-level spend. Google campaign spend is supported; Meta campaign spend remains NULL until canonical campaign/day ingestion exists.';

COMMENT ON VIEW public.vw_doctor_performance_real IS
  'Doctor performance sourced from Doctoralia appointment ingestion when doctor_id is present, with legacy lead fallback and verified settlement revenue.';

COMMIT;
