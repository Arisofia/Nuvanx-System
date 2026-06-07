-- =============================================================================
-- Source comparison and acquisition channel rollups for real dashboard/report data.
--
-- Purpose:
-- - Ensure reports/source-comparison has a concrete production view.
-- - Classify new clients from social networks separately from other acquisition
--   channels using persisted source, UTM and landing attribution fields.
-- - Keep the view security-invoker so existing RLS and API service-role scoping
--   remain auditable and deterministic.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.leads') IS NULL THEN
    RAISE NOTICE 'Skipping source comparison views: public.leads does not exist';
    RETURN;
  END IF;

  DROP VIEW IF EXISTS public.vw_acquisition_channel_daily;
  DROP VIEW IF EXISTS public.vw_source_comparison;

  EXECUTE $view$
    CREATE VIEW public.vw_source_comparison AS
    WITH lead_base AS (
      SELECT
        l.id,
        l.user_id,
        l.clinic_id,
        NULLIF(BTRIM(l.source), '') AS raw_source,
        LOWER(BTRIM(COALESCE(l.source, ''))) AS source_norm,
        LOWER(BTRIM(COALESCE(l.utm_source, ''))) AS utm_source_norm,
        LOWER(BTRIM(COALESCE(l.landing_url, ''))) AS landing_url_norm,
        l.stage,
        l.created_at,
        l.first_outbound_at,
        l.first_inbound_at,
        l.reply_delay_minutes,
        l.converted_patient_id,
        COALESCE(l.verified_revenue, l.revenue, 0)::NUMERIC AS attributable_revenue
      FROM public.leads l
      WHERE l.deleted_at IS NULL
        AND LOWER(BTRIM(COALESCE(l.source, ''))) <> 'doctoralia'
        AND l.user_id IS NOT NULL
    ), classified AS (
      SELECT
        lb.*,
        CASE
          WHEN source_norm IN ('meta_leadgen', 'meta_lead_gen', 'facebook_leadgen', 'meta ads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'facebook', 'instagram', 'fb', 'ig')
            OR source_norm LIKE 'meta%'
            OR source_norm LIKE 'facebook%'
            OR source_norm LIKE 'instagram%'
            OR utm_source_norm IN ('meta', 'facebook', 'instagram', 'fb', 'ig', 'social', 'paid_social')
            OR utm_source_norm LIKE 'meta%'
            OR utm_source_norm LIKE 'facebook%'
            OR utm_source_norm LIKE 'instagram%'
            OR landing_url_norm LIKE '%facebook%'
            OR landing_url_norm LIKE '%instagram%'
            OR landing_url_norm LIKE '%fbclid%'
          THEN 'social'
          WHEN source_norm IN ('google_ads', 'google ads', 'google', 'sem', 'paid_search')
            OR utm_source_norm IN ('google', 'google_ads', 'google ads', 'sem', 'paid_search')
            OR landing_url_norm LIKE '%gclid=%'
          THEN 'paid_search'
          WHEN source_norm IN ('whatsapp', 'meta_whatsapp', 'facebook_whatsapp')
            OR utm_source_norm = 'whatsapp'
          THEN 'whatsapp'
          WHEN source_norm IN ('landing', 'landing_page')
          THEN 'landing'
          ELSE 'other'
        END AS channel_group,
        CASE
          WHEN raw_source IS NULL THEN 'Other / Unattributed'
          WHEN source_norm IN ('meta_leadgen', 'meta_lead_gen', 'facebook_leadgen') THEN 'Meta Lead Ads'
          WHEN source_norm IN ('google_ads', 'google ads') THEN 'Google Ads'
          WHEN source_norm IN ('landing', 'landing_page') THEN 'Landing Page'
          WHEN source_norm IN ('whatsapp', 'meta_whatsapp', 'facebook_whatsapp') THEN 'WhatsApp'
          ELSE INITCAP(REPLACE(raw_source, '_', ' '))
        END AS source_label
      FROM lead_base lb
    )
    SELECT
      user_id,
      clinic_id,
      COALESCE(raw_source, 'other') AS source,
      source_label,
      channel_group,
      COUNT(*)::INTEGER AS total_leads,
      COUNT(*) FILTER (WHERE first_outbound_at IS NOT NULL OR stage IN ('whatsapp', 'appointment', 'treatment', 'closed'))::INTEGER AS contacted,
      COUNT(*) FILTER (WHERE first_inbound_at IS NOT NULL OR stage IN ('appointment', 'treatment', 'closed'))::INTEGER AS replied,
      COUNT(*) FILTER (WHERE stage IN ('appointment', 'treatment', 'closed'))::INTEGER AS booked,
      COUNT(*) FILTER (WHERE stage IN ('treatment', 'closed') OR converted_patient_id IS NOT NULL OR attributable_revenue > 0)::INTEGER AS closed,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE first_inbound_at IS NOT NULL OR stage IN ('appointment', 'treatment', 'closed'))
        / NULLIF(COUNT(*) FILTER (WHERE first_outbound_at IS NOT NULL OR stage IN ('whatsapp', 'appointment', 'treatment', 'closed')), 0),
        1
      ) AS reply_rate_pct,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE stage IN ('appointment', 'treatment', 'closed'))
        / NULLIF(COUNT(*) FILTER (WHERE first_inbound_at IS NOT NULL OR stage IN ('appointment', 'treatment', 'closed')), 0),
        1
      ) AS replied_to_booked_pct,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE stage IN ('treatment', 'closed') OR converted_patient_id IS NOT NULL OR attributable_revenue > 0)
        / NULLIF(COUNT(*), 0),
        1
      ) AS lead_to_close_rate_pct,
      ROUND(AVG(reply_delay_minutes) FILTER (WHERE reply_delay_minutes IS NOT NULL), 1) AS avg_reply_delay_min,
      ROUND(COALESCE(SUM(attributable_revenue), 0), 2) AS verified_revenue_crm,
      MIN(created_at) AS first_lead_at,
      MAX(created_at) AS last_lead_at
    FROM classified
    GROUP BY user_id, clinic_id, COALESCE(raw_source, 'other'), source_label, channel_group
  $view$;

  EXECUTE $view$
    CREATE VIEW public.vw_acquisition_channel_daily AS
    WITH lead_base AS (
      SELECT
        l.user_id,
        l.clinic_id,
        l.created_at::DATE AS lead_date,
        LOWER(BTRIM(COALESCE(l.source, ''))) AS source_norm,
        LOWER(BTRIM(COALESCE(l.utm_source, ''))) AS utm_source_norm,
        LOWER(BTRIM(COALESCE(l.landing_url, ''))) AS landing_url_norm,
        COALESCE(l.verified_revenue, l.revenue, 0)::NUMERIC AS attributable_revenue
      FROM public.leads l
      WHERE l.deleted_at IS NULL
        AND LOWER(BTRIM(COALESCE(l.source, ''))) <> 'doctoralia'
        AND l.user_id IS NOT NULL
    ), classified AS (
      SELECT
        *,
        CASE
          WHEN source_norm IN ('meta_leadgen', 'meta_lead_gen', 'facebook_leadgen', 'meta ads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'facebook', 'instagram', 'fb', 'ig')
            OR source_norm LIKE 'meta%'
            OR source_norm LIKE 'facebook%'
            OR source_norm LIKE 'instagram%'
            OR utm_source_norm IN ('meta', 'facebook', 'instagram', 'fb', 'ig', 'social', 'paid_social')
            OR utm_source_norm LIKE 'meta%'
            OR utm_source_norm LIKE 'facebook%'
            OR utm_source_norm LIKE 'instagram%'
            OR landing_url_norm LIKE '%facebook%'
            OR landing_url_norm LIKE '%instagram%'
            OR landing_url_norm LIKE '%fbclid%'
          THEN 'social'
          WHEN source_norm IN ('google_ads', 'google ads', 'google', 'sem', 'paid_search')
            OR utm_source_norm IN ('google', 'google_ads', 'google ads', 'sem', 'paid_search')
            OR landing_url_norm LIKE '%gclid=%'
          THEN 'paid_search'
          WHEN source_norm IN ('whatsapp', 'meta_whatsapp', 'facebook_whatsapp')
            OR utm_source_norm = 'whatsapp'
          THEN 'whatsapp'
          WHEN source_norm IN ('landing', 'landing_page')
          THEN 'landing'
          ELSE 'other'
        END AS channel_group
      FROM lead_base
    )
    SELECT
      user_id,
      clinic_id,
      channel_group,
      lead_date,
      COUNT(*)::INTEGER AS new_clients,
      COUNT(*) FILTER (WHERE channel_group = 'social')::INTEGER AS social_new_clients,
      COUNT(*) FILTER (WHERE channel_group <> 'social')::INTEGER AS other_channel_new_clients,
      ROUND(COALESCE(SUM(attributable_revenue), 0), 2)::NUMERIC(14,2) AS verified_revenue_crm
    FROM classified
    GROUP BY user_id, clinic_id, channel_group, lead_date
  $view$;

  EXECUTE 'ALTER VIEW public.vw_source_comparison SET (security_invoker = true)';
  EXECUTE 'ALTER VIEW public.vw_acquisition_channel_daily SET (security_invoker = true)';
  EXECUTE 'GRANT SELECT ON public.vw_source_comparison TO authenticated, service_role';
  EXECUTE 'GRANT SELECT ON public.vw_acquisition_channel_daily TO authenticated, service_role';
END $$;

COMMENT ON VIEW public.vw_source_comparison IS
  'Real acquisition source comparison for reports. Includes social-vs-other channel classification from leads.source, UTM and landing attribution; excludes Doctoralia operational rows.';

COMMENT ON VIEW public.vw_acquisition_channel_daily IS
  'Daily rollup of new clients by acquisition channel, including social_new_clients and other_channel_new_clients for dashboard KPI verification.';
