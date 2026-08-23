-- Repair vw_campaign_performance_real on current PostgreSQL.
--
-- The previous FULL JOIN used `IS NOT DISTINCT FROM` for campaign_id. PostgreSQL
-- cannot execute that FULL JOIN because the predicate is not merge/hash-joinable.
-- Campaign ids are text identifiers; normalize NULL to the empty string so the
-- join remains null-safe while using equality, which is hash/merge-joinable.
--
-- Preserve the existing security-invoker contract and exact output schema.

CREATE OR REPLACE VIEW public.vw_campaign_performance_real
WITH (security_invoker = true)
AS
WITH crm_campaigns AS (
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
      WHERE COALESCE(ut.lead_stage::text, l.stage::text) = ANY (ARRAY['closed','won','paid']::text[])
         OR COALESCE(ut.lead_revenue_verified, l.verified_revenue, l.revenue, 0::numeric) > 0
    ) AS closed,
    count(*) FILTER (
      WHERE COALESCE(ut.lead_revenue_verified, l.verified_revenue, 0::numeric) > 0
    ) AS closed_won,
    round(COALESCE(sum(COALESCE(ut.lead_revenue_estimated, l.revenue, 0::numeric)), 0::numeric), 2) AS estimated_revenue,
    round(COALESCE(sum(COALESCE(ut.lead_revenue_verified, l.verified_revenue, 0::numeric)), 0::numeric), 2) AS verified_revenue_crm,
    NULL::numeric AS reply_rate_pct,
    NULL::numeric AS replied_to_booked_pct,
    round(
      100.0 * count(*) FILTER (
        WHERE COALESCE(ut.lead_stage::text, l.stage::text) = ANY (ARRAY['closed','won','paid']::text[])
           OR COALESCE(ut.lead_revenue_verified, l.verified_revenue, l.revenue, 0::numeric) > 0
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
  LEFT JOIN public.vw_doctoralia_lead_traceability_unified ut ON ut.lead_id = l.id
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
    )
),
meta_campaigns AS (
  SELECT
    mc.user_id,
    campaign.value ->> 'name' AS campaign_name,
    campaign.value ->> 'id' AS campaign_id,
    'meta_current'::text AS source,
    COALESCE((
      SELECT sum((a.value ->> 'value')::numeric)::bigint
      FROM jsonb_array_elements(COALESCE((campaign.value -> 'insights') -> 'actions', '[]'::jsonb)) a(value)
      WHERE (a.value ->> 'action_type') = ANY (
        ARRAY[
          'offsite_complete_registration_add_meta_leads',
          'offsite_search_add_meta_leads',
          'onsite_conversion.lead_grouped',
          'lead',
          'onsite_conversion.messaging_conversation_started_7d'
        ]::text[]
      )
      OR (a.value ->> 'action_type') ILIKE '%messaging_conversation_started%'
    ), 0::bigint) AS meta_total_leads
  FROM public.meta_cache mc
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(mc.data -> 'campaigns', '[]'::jsonb)) campaign(value)
  WHERE mc.id = 'meta:campaigns'
    AND campaign.value ? 'id'
),
merged AS (
  SELECT
    COALESCE(crm.user_id, meta.user_id) AS user_id,
    COALESCE(crm.campaign_name, meta.campaign_name, 'Meta / Unknown') AS campaign_name,
    COALESCE(crm.campaign_id, meta.campaign_id) AS campaign_id,
    CASE WHEN crm.campaign_id IS NOT NULL THEN crm.source ELSE meta.source END AS source,
    CASE WHEN crm.campaign_id IS NOT NULL THEN crm.total_leads ELSE COALESCE(meta.meta_total_leads, 0::bigint) END AS total_leads,
    COALESCE(crm.contacted, 0::bigint) AS contacted,
    COALESCE(crm.replied, 0::bigint) AS replied,
    COALESCE(crm.booked, 0::bigint) AS booked,
    COALESCE(crm.attended, 0::bigint) AS attended,
    COALESCE(crm.no_shows, 0::bigint) AS no_shows,
    COALESCE(crm.closed, 0::bigint) AS closed,
    COALESCE(crm.closed_won, 0::bigint) AS closed_won,
    COALESCE(crm.estimated_revenue, 0::numeric) AS estimated_revenue,
    COALESCE(crm.verified_revenue_crm, 0::numeric) AS verified_revenue_crm,
    crm.reply_rate_pct,
    crm.replied_to_booked_pct,
    CASE WHEN crm.campaign_id IS NOT NULL THEN crm.lead_to_close_rate_pct ELSE 0::numeric END AS lead_to_close_rate_pct,
    CASE WHEN crm.campaign_id IS NOT NULL THEN crm.no_show_rate_pct ELSE 0::numeric END AS no_show_rate_pct,
    crm.avg_reply_delay_min,
    crm.first_lead_at,
    crm.last_lead_at
  FROM meta_campaigns meta
  FULL JOIN crm_campaigns crm
    ON crm.user_id = meta.user_id
   AND COALESCE(crm.campaign_id, '') = COALESCE(meta.campaign_id, '')
)
SELECT
  user_id,
  campaign_name,
  campaign_id,
  source,
  total_leads,
  contacted,
  replied,
  booked,
  attended,
  no_shows,
  closed,
  closed_won,
  estimated_revenue,
  verified_revenue_crm,
  reply_rate_pct,
  replied_to_booked_pct,
  lead_to_close_rate_pct,
  no_show_rate_pct,
  avg_reply_delay_min,
  first_lead_at,
  last_lead_at
FROM merged;
