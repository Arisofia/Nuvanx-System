-- Keep Control Centre metrics fail-closed when the underlying fact is not measured.
-- Production ledger version: 20260827155228.
--
-- 1) vw_campaign_performance_real must not turn missing WhatsApp/revenue facts into zero.
-- 2) get_campaign_roi must not repeat account-level monthly spend on every campaign,
--    and Doctoralia appointment amounts are not reconciled cash/revenue.

CREATE OR REPLACE VIEW public.vw_campaign_performance_real AS
WITH doctoralia_per_lead AS (
  SELECT
    u.lead_id,
    bool_or(u.appointment_status IS NOT NULL) AS has_appointment,
    bool_or(lower(COALESCE(u.appointment_status::text, '')) = ANY (ARRAY['realizada','pagada','showed','attended','completed'])) AS attended,
    bool_or(
      COALESCE(u.no_show_flag, false)
      OR lower(COALESCE(u.appointment_status::text, '')) = ANY (ARRAY['no presentado','no_show','no-show','noshow'])
    ) AS no_show
  FROM public.vw_doctoralia_lead_traceability_unified u
  WHERE u.lead_id IS NOT NULL
  GROUP BY u.lead_id
)
SELECT
  l.user_id,
  COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown'::varchar)::text AS campaign_name,
  COALESCE(ma.campaign_id, l.campaign_id)::text AS campaign_id,
  COALESCE(
    NULLIF(l.utm_source, ''),
    NULLIF(l.source::text, ''),
    CASE WHEN ma.lead_id IS NOT NULL THEN 'meta'::text ELSE 'unknown'::text END
  ) AS source,
  count(DISTINCT l.id) AS total_leads,
  NULL::bigint AS contacted,
  NULL::bigint AS replied,
  count(DISTINCT l.id) FILTER (
    WHERE l.appointment_date IS NOT NULL
      OR l.appointment_status IS NOT NULL
      OR COALESCE(ut.has_appointment, false)
      OR lower(COALESCE(l.stage::text, '')) = ANY (ARRAY['scheduled','confirmed','showed','completed','convertido','closed'])
  ) AS booked,
  count(DISTINCT l.id) FILTER (
    WHERE l.attended_at IS NOT NULL
      OR COALESCE(ut.attended, false)
      OR lower(COALESCE(l.appointment_status::text, l.stage::text, '')) = ANY (ARRAY['showed','attended','completed','realizada','pagada'])
  ) AS attended,
  count(DISTINCT l.id) FILTER (
    WHERE COALESCE(ut.no_show, l.no_show_flag, false) = true
      OR lower(COALESCE(l.appointment_status::text, l.stage::text, '')) = ANY (ARRAY['no presentado','no_show','no-show','noshow'])
  ) AS no_shows,
  count(DISTINCT l.id) FILTER (
    WHERE lower(COALESCE(l.stage::text, '')) = ANY (ARRAY['closed','won','paid','convertido'])
  ) AS closed,
  count(DISTINCT l.id) FILTER (
    WHERE lower(COALESCE(l.stage::text, '')) = ANY (ARRAY['won','paid'])
  ) AS closed_won,
  NULL::numeric AS estimated_revenue,
  NULL::numeric AS verified_revenue_crm,
  NULL::numeric AS reply_rate_pct,
  NULL::numeric AS replied_to_booked_pct,
  round(
    100.0 * count(DISTINCT l.id) FILTER (
      WHERE lower(COALESCE(l.stage::text, '')) = ANY (ARRAY['closed','won','paid','convertido'])
    )::numeric / NULLIF(count(DISTINCT l.id), 0)::numeric,
    2
  ) AS lead_to_close_rate_pct,
  round(
    100.0 * count(DISTINCT l.id) FILTER (
      WHERE COALESCE(ut.no_show, l.no_show_flag, false) = true
        OR lower(COALESCE(l.appointment_status::text, l.stage::text, '')) = ANY (ARRAY['no presentado','no_show','no-show','noshow'])
    )::numeric / NULLIF(count(DISTINCT l.id), 0)::numeric,
    2
  ) AS no_show_rate_pct,
  NULL::numeric AS avg_reply_delay_min,
  min(l.created_at) AS first_lead_at,
  max(l.created_at) AS last_lead_at
FROM public.leads l
LEFT JOIN doctoralia_per_lead ut ON ut.lead_id = l.id
LEFT JOIN public.meta_attribution ma ON ma.lead_id = l.id
WHERE l.deleted_at IS NULL
GROUP BY
  l.user_id,
  COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown'::varchar)::text,
  COALESCE(ma.campaign_id, l.campaign_id)::text,
  COALESCE(
    NULLIF(l.utm_source, ''),
    NULLIF(l.source::text, ''),
    CASE WHEN ma.lead_id IS NOT NULL THEN 'meta'::text ELSE 'unknown'::text END
  );

CREATE OR REPLACE FUNCTION public.get_campaign_roi(
  p_user_id uuid,
  p_from text DEFAULT ''::text,
  p_to text DEFAULT ''::text,
  p_source text DEFAULT ''::text
)
RETURNS TABLE(
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
AS $function$
  WITH trace AS (
    SELECT
      COALESCE(t.campaign_name, 'Organic / Unknown') AS campaign_name,
      COALESCE(t.source, 'Unknown') AS source,
      DATE_TRUNC('month', t.lead_created_at) AS month_date,
      t.lead_id,
      COALESCE(t.patient_id, u.lead_converted_patient_id) AS patient_id
    FROM public.vw_lead_traceability t
    LEFT JOIN public.vw_doctoralia_lead_traceability_unified u
      ON u.lead_id = t.lead_id
    WHERE t.lead_user_id = p_user_id
      AND (p_from = '' OR t.lead_created_at >= p_from::timestamptz)
      AND (p_to = '' OR t.lead_created_at <= (p_to || 'T23:59:59Z')::timestamptz)
      AND (p_source = '' OR t.source = p_source)
  )
  SELECT
    t.campaign_name,
    t.source,
    TO_CHAR(t.month_date, 'YYYY-MM') AS month,
    COUNT(DISTINCT t.lead_id) AS leads_count,
    COUNT(DISTINCT t.patient_id) FILTER (WHERE t.patient_id IS NOT NULL) AS patients_count,
    NULL::numeric AS net_revenue,
    NULL::numeric AS spend,
    NULL::numeric AS cac
  FROM trace t
  GROUP BY t.campaign_name, t.source, t.month_date
  ORDER BY t.month_date DESC, COUNT(DISTINCT t.lead_id) DESC;
$function$;
