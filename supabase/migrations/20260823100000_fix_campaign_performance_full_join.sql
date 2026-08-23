-- Repair vw_campaign_performance_real on current PostgreSQL and make the
-- campaign contract replay-safe.
--
-- A clean repository replay reaches this migration with the historical
-- 13-column view created in 20260610213000, while production already has the
-- later 21-column contract. CREATE OR REPLACE VIEW cannot reorder/rename that
-- legacy shape, so only the incompatible replay shape is dropped explicitly.
-- The sole relation dependency is v_figma_campaign_kpis, which is recreated
-- below. Production's compatible 21-column view is replaced in place.
--
-- The previous production definition also mixed persisted CRM campaign facts
-- with a meta_cache JSON snapshot. Fresh Supabase Preview databases do not have
-- that production-only relation at this point in migration replay. Campaign
-- performance here is therefore derived only from persisted leads plus
-- persisted attribution/Doctoralia traceability. Meta Ads reporting remains
-- served by its dedicated Meta endpoints/tables.
--
-- Doctoralia traceability can expose multiple appointment rows for one lead.
-- Collapse those facts to one row per lead before joining and use DISTINCT lead
-- counts defensively so a multi-appointment patient cannot inflate campaign KPIs.
--
-- Monetary columns are retained only for backwards-compatible output shape and
-- are hard-zeroed: Doctoralia appointment "Importe" is not a reconciled cash or
-- payment ledger and must not be exposed as verified campaign revenue.

DO $$
DECLARE
  current_signature text;
  expected_signature constant text :=
    'user_id,campaign_name,campaign_id,source,total_leads,contacted,replied,booked,attended,no_shows,closed,closed_won,estimated_revenue,verified_revenue_crm,reply_rate_pct,replied_to_booked_pct,lead_to_close_rate_pct,no_show_rate_pct,avg_reply_delay_min,first_lead_at,last_lead_at';
BEGIN
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
  INTO current_signature
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'vw_campaign_performance_real';

  IF current_signature IS DISTINCT FROM expected_signature THEN
    -- Historical replay has one known relational dependent. Drop it first so
    -- the target view can be rebuilt with the canonical 21-column contract.
    DROP VIEW IF EXISTS public.v_figma_campaign_kpis;
    DROP VIEW IF EXISTS public.vw_campaign_performance_real;
  END IF;
END
$$;

CREATE OR REPLACE VIEW public.vw_campaign_performance_real
WITH (security_invoker = true)
AS
WITH doctoralia_per_lead AS (
  SELECT
    lead_id,
    bool_or(appointment_status IS NOT NULL) AS has_appointment,
    bool_or(
      lower(COALESCE(appointment_status::text, '')) = ANY (
        ARRAY['realizada','pagada','showed','attended','completed']::text[]
      )
    ) AS attended,
    bool_or(
      COALESCE(no_show_flag, false)
      OR lower(COALESCE(appointment_status::text, '')) = ANY (
        ARRAY['no presentado','no_show','no-show','noshow']::text[]
      )
    ) AS no_show
  FROM public.vw_doctoralia_lead_traceability_unified
  WHERE lead_id IS NOT NULL
  GROUP BY lead_id
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
  0::bigint AS contacted,
  0::bigint AS replied,
  count(DISTINCT l.id) FILTER (
    WHERE l.appointment_date IS NOT NULL
       OR l.appointment_status IS NOT NULL
       OR COALESCE(ut.has_appointment, false)
       OR lower(COALESCE(l.stage::text, '')) = ANY (
         ARRAY['scheduled','confirmed','showed','completed','convertido','closed']::text[]
       )
  ) AS booked,
  count(DISTINCT l.id) FILTER (
    WHERE l.attended_at IS NOT NULL
       OR COALESCE(ut.attended, false)
       OR lower(COALESCE(l.appointment_status::text, l.stage::text, '')) = ANY (
         ARRAY['showed','attended','completed','realizada','pagada']::text[]
       )
  ) AS attended,
  count(DISTINCT l.id) FILTER (
    WHERE COALESCE(ut.no_show, l.no_show_flag, false) = true
       OR lower(COALESCE(l.appointment_status::text, l.stage::text, '')) = ANY (
         ARRAY['no presentado','no_show','no-show','noshow']::text[]
       )
  ) AS no_shows,
  count(DISTINCT l.id) FILTER (
    WHERE lower(COALESCE(l.stage::text, '')) = ANY (
      ARRAY['closed','won','paid','convertido']::text[]
    )
  ) AS closed,
  count(DISTINCT l.id) FILTER (
    WHERE lower(COALESCE(l.stage::text, '')) = ANY (
      ARRAY['won','paid']::text[]
    )
  ) AS closed_won,
  0::numeric AS estimated_revenue,
  0::numeric AS verified_revenue_crm,
  NULL::numeric AS reply_rate_pct,
  NULL::numeric AS replied_to_booked_pct,
  round(
    100.0 * count(DISTINCT l.id) FILTER (
      WHERE lower(COALESCE(l.stage::text, '')) = ANY (
        ARRAY['closed','won','paid','convertido']::text[]
      )
    )::numeric / NULLIF(count(DISTINCT l.id), 0)::numeric,
    2
  ) AS lead_to_close_rate_pct,
  round(
    100.0 * count(DISTINCT l.id) FILTER (
      WHERE COALESCE(ut.no_show, l.no_show_flag, false) = true
         OR lower(COALESCE(l.appointment_status::text, l.stage::text, '')) = ANY (
           ARRAY['no presentado','no_show','no-show','noshow']::text[]
         )
    )::numeric / NULLIF(count(DISTINCT l.id), 0)::numeric,
    2
  ) AS no_show_rate_pct,
  NULL::numeric AS avg_reply_delay_min,
  min(l.created_at) AS first_lead_at,
  max(l.created_at) AS last_lead_at
FROM public.leads l
LEFT JOIN doctoralia_per_lead ut
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

-- If the historical replay path had to drop the dependent view, restore its
-- current operational contract. On production this is an in-place replacement.
CREATE OR REPLACE VIEW public.v_figma_campaign_kpis
WITH (security_invoker = true)
AS
SELECT
  campaign_name,
  min(campaign_id) AS campaign_id,
  sum(total_leads) AS total_leads,
  sum(booked) AS booked,
  sum(attended) AS attended,
  sum(no_shows) AS no_shows,
  sum(closed) AS closed_won,
  COALESCE(sum(verified_revenue_crm), 0::numeric) AS verified_revenue,
  round(
    CASE
      WHEN sum(total_leads) > 0::numeric THEN sum(booked) / sum(total_leads) * 100::numeric
      ELSE 0::numeric
    END,
    2
  ) AS booking_rate_pct,
  round(
    CASE
      WHEN sum(total_leads) > 0::numeric THEN sum(closed) / sum(total_leads) * 100::numeric
      ELSE 0::numeric
    END,
    2
  ) AS close_rate_pct,
  round(
    CASE
      WHEN sum(booked) > 0::numeric THEN sum(no_shows) / sum(booked) * 100::numeric
      ELSE 0::numeric
    END,
    2
  ) AS no_show_rate_pct,
  min(first_lead_at) AS first_lead_at,
  max(last_lead_at) AS last_lead_at
FROM public.vw_campaign_performance_real
WHERE campaign_name IS NOT NULL
GROUP BY campaign_name
ORDER BY sum(total_leads) DESC;

-- Safe minimum privileges for a recreated preview view. Existing production
-- grants are preserved by CREATE OR REPLACE; these grants are additive only.
GRANT SELECT ON public.vw_campaign_performance_real TO authenticated, service_role;
GRANT SELECT ON public.v_figma_campaign_kpis TO authenticated, service_role;
