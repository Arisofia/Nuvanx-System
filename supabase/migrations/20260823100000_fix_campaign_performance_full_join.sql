-- Repair vw_campaign_performance_real on current PostgreSQL and make the
-- campaign contract replay-safe.
--
-- The previous definition mixed persisted CRM campaign facts with a meta_cache
-- JSON snapshot through a FULL JOIN using `IS NOT DISTINCT FROM`. PostgreSQL
-- cannot execute that FULL JOIN because the predicate is not merge/hash-joinable,
-- and fresh Supabase Preview databases do not have the production-only
-- public.meta_cache relation at this point in migration replay.
--
-- Campaign performance in this view is therefore derived only from persisted
-- leads plus persisted attribution/Doctoralia traceability. Meta Ads reporting
-- remains served by its dedicated Meta endpoints/tables.
--
-- Monetary columns are retained only for backwards-compatible output shape and
-- are hard-zeroed: Doctoralia appointment "Importe" is not a reconciled cash or
-- payment ledger and must not be exposed as verified campaign revenue.
--
-- Preserve security-invoker behavior and the exact output column order/types.

CREATE OR REPLACE VIEW public.vw_campaign_performance_real
WITH (security_invoker = true)
AS
SELECT
  l.user_id,
  COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown'::varchar)::text AS campaign_name,
  COALESCE(ma.campaign_id, l.campaign_id)::text AS campaign_id,
  COALESCE(
    NULLIF(l.utm_source, ''),
    NULLIF(l.source::text, ''),
    CASE WHEN ma.lead_id IS NOT NULL THEN 'meta'::text ELSE 'unknown'::text END
  ) AS source,
  count(*) AS total_leads,
  0::bigint AS contacted,
  0::bigint AS replied,
  count(*) FILTER (
    WHERE l.appointment_date IS NOT NULL
       OR l.appointment_status IS NOT NULL
       OR COALESCE(ut.lead_stage::text, l.stage::text) = ANY (
         ARRAY['scheduled','confirmed','showed','completed','convertido','closed']::text[]
       )
  ) AS booked,
  count(*) FILTER (
    WHERE COALESCE(ut.attended_at, l.attended_at) IS NOT NULL
       OR COALESCE(ut.lead_stage::text, l.appointment_status::text, l.stage::text) = ANY (
         ARRAY['showed','completed']::text[]
       )
  ) AS attended,
  count(*) FILTER (
    WHERE COALESCE(ut.no_show_flag, l.no_show_flag, false) = true
       OR COALESCE(ut.lead_stage::text, l.appointment_status::text, l.stage::text) = ANY (
         ARRAY['no_show','no-show','noshow']::text[]
       )
  ) AS no_shows,
  count(*) FILTER (
    WHERE lower(COALESCE(ut.lead_stage::text, l.stage::text, '')) = ANY (
      ARRAY['closed','won','paid','convertido']::text[]
    )
  ) AS closed,
  count(*) FILTER (
    WHERE lower(COALESCE(ut.lead_stage::text, l.stage::text, '')) = ANY (
      ARRAY['won','paid']::text[]
    )
  ) AS closed_won,
  0::numeric AS estimated_revenue,
  0::numeric AS verified_revenue_crm,
  NULL::numeric AS reply_rate_pct,
  NULL::numeric AS replied_to_booked_pct,
  round(
    100.0 * count(*) FILTER (
      WHERE lower(COALESCE(ut.lead_stage::text, l.stage::text, '')) = ANY (
        ARRAY['closed','won','paid','convertido']::text[]
      )
    )::numeric / NULLIF(count(*), 0)::numeric,
    2
  ) AS lead_to_close_rate_pct,
  round(
    100.0 * count(*) FILTER (
      WHERE COALESCE(ut.no_show_flag, l.no_show_flag, false) = true
         OR COALESCE(ut.lead_stage::text, l.appointment_status::text, l.stage::text) = ANY (
           ARRAY['no_show','no-show','noshow']::text[]
         )
    )::numeric / NULLIF(count(*), 0)::numeric,
    2
  ) AS no_show_rate_pct,
  NULL::numeric AS avg_reply_delay_min,
  min(COALESCE(ut.lead_created_at, l.created_at)) AS first_lead_at,
  max(COALESCE(ut.lead_created_at, l.created_at)) AS last_lead_at
FROM public.leads l
LEFT JOIN public.vw_doctoralia_lead_traceability_unified ut
  ON ut.lead_id = l.id
LEFT JOIN public.meta_attribution ma
  ON ma.lead_id = l.id
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
