-- Restore the campaign-performance RPC consumed by both Dashboard and Reports.
--
-- The API currently has two historical named-argument callers:
--   * dashboard/campaigns-filter -> p_from_date / p_to_date
--   * reports/campaign-performance -> from_date / to_date
-- A single four-argument function with defaults accepts either named subset via
-- PostgREST while returning the current Control Centre campaign shape.

BEGIN;

DROP FUNCTION IF EXISTS public.get_campaign_report(date, date);
DROP FUNCTION IF EXISTS public.get_campaign_report(date, date, date, date);

CREATE FUNCTION public.get_campaign_report(
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
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH params AS (
    SELECT
      COALESCE(from_date, p_from_date, CURRENT_DATE - 30) AS since_date,
      COALESCE(to_date, p_to_date, CURRENT_DATE) AS until_date
  ),
  base AS (
    SELECT
      l.id,
      COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::text AS campaign_name,
      COALESCE(ma.campaign_id, l.campaign_id)::text AS campaign_id,
      COALESCE(
        NULLIF(l.utm_source, ''),
        NULLIF(l.source::text, ''),
        CASE WHEN ma.lead_id IS NOT NULL THEN 'meta' ELSE 'unknown' END
      )::text AS source,
      l.created_at,
      l.first_outbound_at,
      l.first_inbound_at,
      l.reply_delay_minutes,
      l.appointment_date,
      l.appointment_status,
      l.stage,
      l.attended_at,
      l.no_show_flag,
      l.revenue,
      l.verified_revenue
    FROM public.leads l
    LEFT JOIN public.meta_attribution ma ON ma.lead_id = l.id
    CROSS JOIN params p
    WHERE l.deleted_at IS NULL
      AND l.created_at::date BETWEEN p.since_date AND p.until_date
  )
  SELECT
    b.campaign_name,
    b.campaign_id,
    b.source,
    COUNT(*)::bigint AS total_leads,
    COUNT(*) FILTER (WHERE b.first_outbound_at IS NOT NULL)::bigint AS contacted,
    COUNT(*) FILTER (WHERE b.first_inbound_at IS NOT NULL)::bigint AS replied,
    COUNT(*) FILTER (
      WHERE b.appointment_date IS NOT NULL
         OR b.appointment_status IS NOT NULL
         OR lower(COALESCE(b.stage::text, '')) IN ('scheduled', 'confirmed', 'showed', 'completed', 'convertido', 'closed')
    )::bigint AS booked,
    COUNT(*) FILTER (
      WHERE b.attended_at IS NOT NULL
         OR lower(COALESCE(b.appointment_status::text, b.stage::text, '')) IN ('showed', 'completed')
    )::bigint AS attended,
    COUNT(*) FILTER (
      WHERE COALESCE(b.no_show_flag, false)
         OR lower(COALESCE(b.appointment_status::text, b.stage::text, '')) IN ('no_show', 'no-show', 'noshow')
    )::bigint AS no_shows,
    COUNT(*) FILTER (
      WHERE lower(COALESCE(b.stage::text, '')) IN ('closed', 'won', 'paid')
         OR COALESCE(b.verified_revenue, b.revenue, 0) > 0
    )::bigint AS closed,
    COUNT(*) FILTER (WHERE COALESCE(b.verified_revenue, 0) > 0)::bigint AS closed_won,
    round(COALESCE(sum(COALESCE(b.revenue, 0)), 0), 2) AS estimated_revenue,
    round(COALESCE(sum(COALESCE(b.verified_revenue, 0)), 0), 2) AS verified_revenue_crm,
    round(
      100.0 * COUNT(*) FILTER (WHERE b.first_inbound_at IS NOT NULL)
      / NULLIF(COUNT(*), 0),
      2
    ) AS reply_rate_pct,
    round(
      100.0 * COUNT(*) FILTER (
        WHERE b.appointment_date IS NOT NULL
           OR b.appointment_status IS NOT NULL
           OR lower(COALESCE(b.stage::text, '')) IN ('scheduled', 'confirmed', 'showed', 'completed', 'convertido', 'closed')
      )
      / NULLIF(COUNT(*) FILTER (WHERE b.first_inbound_at IS NOT NULL), 0),
      2
    ) AS replied_to_booked_pct,
    round(
      100.0 * COUNT(*) FILTER (
        WHERE lower(COALESCE(b.stage::text, '')) IN ('closed', 'won', 'paid')
           OR COALESCE(b.verified_revenue, b.revenue, 0) > 0
      )
      / NULLIF(COUNT(*), 0),
      2
    ) AS lead_to_close_rate_pct,
    round(
      100.0 * COUNT(*) FILTER (
        WHERE COALESCE(b.no_show_flag, false)
           OR lower(COALESCE(b.appointment_status::text, b.stage::text, '')) IN ('no_show', 'no-show', 'noshow')
      )
      / NULLIF(COUNT(*), 0),
      2
    ) AS no_show_rate_pct,
    round(avg(b.reply_delay_minutes)::numeric, 2) AS avg_reply_delay_min,
    min(b.created_at) AS first_lead_at,
    max(b.created_at) AS last_lead_at
  FROM base b
  GROUP BY b.campaign_name, b.campaign_id, b.source
  ORDER BY total_leads DESC, verified_revenue_crm DESC, last_lead_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_report(date, date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_campaign_report(date, date, date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_campaign_report(date, date, date, date) IS
  'Canonical campaign report for Control Centre. Accepts both legacy date argument names and aggregates only real CRM lead rows.';

COMMIT;
