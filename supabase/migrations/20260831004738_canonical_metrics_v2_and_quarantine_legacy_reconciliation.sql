-- Canonical Metrics v2
-- Quarantine legacy phone/revenue conversion logic while preserving historical migrations.

CREATE OR REPLACE FUNCTION public.reconcile_doctoralia_subjects_to_leads(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Deprecated compatibility entrypoint.
  -- Historical implementations matched settlements by phone, copied revenue into
  -- leads.verified_revenue and could promote leads.stage to 'convertido'. The
  -- canonical pipeline is now evidence-driven from ordered Doctoralia visits, and
  -- payment/revenue must never advance clinical stage. Keep the function callable
  -- for old API jobs, but make it mutation-free.
  RETURN 0;
END;
$function$;

COMMENT ON FUNCTION public.reconcile_doctoralia_subjects_to_leads(uuid) IS
'DEPRECATED compatibility no-op. Historical phone/revenue reconciliation is retained in migration history only. Canonical conversion is derived from vw_control_centre_pipeline Doctoralia journey evidence; revenue never advances stage.';

CREATE OR REPLACE VIEW public.vw_campaign_performance_real
WITH (security_invoker = true)
AS
WITH base AS (
  SELECT
    l.id,
    l.user_id,
    l.clinic_id,
    l.created_at,
    l.first_outbound_at,
    l.first_response_at,
    l.first_inbound_at,
    l.reply_delay_minutes,
    l.utm_source,
    l.source,
    COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::text AS campaign_name,
    COALESCE(ma.campaign_id, l.campaign_id)::text AS campaign_id,
    CASE
      WHEN NULLIF(btrim(l.utm_source), '') IS NOT NULL THEN btrim(l.utm_source)
      WHEN NULLIF(btrim(l.source::text), '') IS NOT NULL THEN btrim(l.source::text)
      WHEN ma.lead_id IS NOT NULL THEN 'meta'
      ELSE 'unknown'
    END AS source_resolved,
    p.pipeline_stage,
    p.journey_appointment_count,
    p.valuation_appointment_date,
    p.treatment_appointment_date,
    p.first_control_appointment_date,
    p.is_new_client,
    p.client_completed_at,
    p.verified_revenue
  FROM public.leads l
  JOIN public.vw_control_centre_pipeline p ON p.lead_id = l.id
  LEFT JOIN public.meta_attribution ma ON ma.lead_id = l.id
  WHERE l.deleted_at IS NULL
    AND l.merged_into_lead_id IS NULL
    AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
)
SELECT
  user_id,
  campaign_name,
  campaign_id,
  source_resolved AS source,
  count(DISTINCT id) AS total_leads,
  count(DISTINCT id) FILTER (
    WHERE first_outbound_at IS NOT NULL OR first_response_at IS NOT NULL OR first_inbound_at IS NOT NULL
  ) AS contacted,
  count(DISTINCT id) FILTER (WHERE first_inbound_at IS NOT NULL) AS replied,
  count(DISTINCT id) FILTER (WHERE journey_appointment_count >= 1) AS booked,
  count(DISTINCT id) FILTER (
    WHERE valuation_appointment_date IS NOT NULL AND valuation_appointment_date <= CURRENT_DATE
  ) AS attended,
  NULL::bigint AS no_shows,
  count(DISTINCT id) FILTER (WHERE is_new_client) AS closed,
  count(DISTINCT id) FILTER (WHERE client_completed_at IS NOT NULL) AS closed_won,
  NULL::numeric AS estimated_revenue,
  round(COALESCE(sum(verified_revenue), 0::numeric), 2) AS verified_revenue_crm,
  round(
    100.0 * count(DISTINCT id) FILTER (WHERE first_inbound_at IS NOT NULL)::numeric /
    NULLIF(count(DISTINCT id) FILTER (
      WHERE first_outbound_at IS NOT NULL OR first_response_at IS NOT NULL OR first_inbound_at IS NOT NULL
    ), 0)::numeric,
    2
  ) AS reply_rate_pct,
  round(
    100.0 * count(DISTINCT id) FILTER (WHERE journey_appointment_count >= 1)::numeric /
    NULLIF(count(DISTINCT id) FILTER (WHERE first_inbound_at IS NOT NULL), 0)::numeric,
    2
  ) AS replied_to_booked_pct,
  round(
    100.0 * count(DISTINCT id) FILTER (WHERE is_new_client)::numeric /
    NULLIF(count(DISTINCT id), 0)::numeric,
    2
  ) AS lead_to_close_rate_pct,
  NULL::numeric AS no_show_rate_pct,
  round(avg(reply_delay_minutes) FILTER (WHERE reply_delay_minutes IS NOT NULL), 1) AS avg_reply_delay_min,
  min(created_at) AS first_lead_at,
  max(created_at) AS last_lead_at
FROM base
GROUP BY user_id, campaign_name, campaign_id, source_resolved;

CREATE OR REPLACE VIEW public.vw_source_comparison
WITH (security_invoker = true)
AS
WITH lead_base AS (
  SELECT
    l.id,
    l.user_id,
    l.clinic_id,
    NULLIF(btrim(l.source::text), '') AS raw_source,
    lower(btrim(COALESCE(l.source, '')::text)) AS source_norm,
    lower(btrim(COALESCE(l.utm_source, ''))) AS utm_source_norm,
    lower(btrim(COALESCE(l.landing_url, ''))) AS landing_url_norm,
    l.gclid,
    l.created_at,
    l.first_outbound_at,
    l.first_response_at,
    l.first_inbound_at,
    l.reply_delay_minutes,
    p.pipeline_stage,
    p.journey_appointment_count,
    p.is_new_client,
    p.client_completed_at,
    p.verified_revenue
  FROM public.leads l
  JOIN public.vw_control_centre_pipeline p ON p.lead_id = l.id
  WHERE l.deleted_at IS NULL
    AND l.merged_into_lead_id IS NULL
    AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
    AND l.user_id IS NOT NULL
), classified AS (
  SELECT
    lb.*,
    CASE
      WHEN lb.source_norm = ANY (ARRAY['meta_leadgen','meta_lead_gen','facebook_leadgen','meta ads','meta_ads','facebook_ads','instagram_ads','facebook','instagram','fb','ig'])
        OR lb.source_norm LIKE 'meta%'
        OR lb.source_norm LIKE 'facebook%'
        OR lb.source_norm LIKE 'instagram%'
        OR lb.utm_source_norm = ANY (ARRAY['meta','facebook','instagram','fb','ig','social','paid_social'])
        OR lb.utm_source_norm LIKE 'meta%'
        OR lb.utm_source_norm LIKE 'facebook%'
        OR lb.utm_source_norm LIKE 'instagram%'
        OR lb.landing_url_norm LIKE '%facebook%'
        OR lb.landing_url_norm LIKE '%instagram%'
        OR lb.landing_url_norm LIKE '%fbclid%'
        THEN 'social'
      WHEN lb.source_norm = ANY (ARRAY['google_ads','google ads','google','sem','paid_search'])
        OR lb.utm_source_norm = ANY (ARRAY['google','google_ads','google ads','sem','paid_search'])
        OR NULLIF(btrim(lb.gclid), '') IS NOT NULL
        OR lb.landing_url_norm LIKE '%gclid=%'
        THEN 'paid_search'
      WHEN lb.source_norm = ANY (ARRAY['whatsapp','meta_whatsapp','facebook_whatsapp'])
        OR lb.utm_source_norm = 'whatsapp'
        THEN 'whatsapp'
      WHEN lb.source_norm = ANY (ARRAY['landing','landing_page']) THEN 'landing'
      ELSE 'other'
    END AS channel_group,
    CASE
      WHEN lb.raw_source IS NULL THEN 'Other / Unattributed'
      WHEN lb.source_norm = ANY (ARRAY['meta_leadgen','meta_lead_gen','facebook_leadgen']) THEN 'Meta Lead Ads'
      WHEN lb.source_norm = ANY (ARRAY['google_ads','google ads']) THEN 'Google Ads'
      WHEN lb.source_norm = ANY (ARRAY['landing','landing_page']) THEN 'Landing Page'
      WHEN lb.source_norm = ANY (ARRAY['whatsapp','meta_whatsapp','facebook_whatsapp']) THEN 'WhatsApp'
      ELSE initcap(replace(lb.raw_source, '_', ' '))
    END AS source_label
  FROM lead_base lb
)
SELECT
  user_id,
  clinic_id,
  COALESCE(raw_source, 'other') AS source,
  source_label,
  channel_group,
  count(*)::integer AS total_leads,
  count(*) FILTER (
    WHERE first_outbound_at IS NOT NULL OR first_response_at IS NOT NULL OR first_inbound_at IS NOT NULL
  )::integer AS contacted,
  count(*) FILTER (WHERE first_inbound_at IS NOT NULL)::integer AS replied,
  count(*) FILTER (WHERE journey_appointment_count >= 1)::integer AS booked,
  count(*) FILTER (WHERE is_new_client)::integer AS closed,
  round(
    100.0 * count(*) FILTER (WHERE first_inbound_at IS NOT NULL)::numeric /
    NULLIF(count(*) FILTER (
      WHERE first_outbound_at IS NOT NULL OR first_response_at IS NOT NULL OR first_inbound_at IS NOT NULL
    ), 0)::numeric,
    1
  ) AS reply_rate_pct,
  round(
    100.0 * count(*) FILTER (WHERE journey_appointment_count >= 1)::numeric /
    NULLIF(count(*) FILTER (WHERE first_inbound_at IS NOT NULL), 0)::numeric,
    1
  ) AS replied_to_booked_pct,
  round(
    100.0 * count(*) FILTER (WHERE is_new_client)::numeric /
    NULLIF(count(*), 0)::numeric,
    1
  ) AS lead_to_close_rate_pct,
  round(avg(reply_delay_minutes) FILTER (WHERE reply_delay_minutes IS NOT NULL), 1) AS avg_reply_delay_min,
  round(COALESCE(sum(verified_revenue), 0::numeric), 2) AS verified_revenue_crm,
  min(created_at) AS first_lead_at,
  max(created_at) AS last_lead_at
FROM classified
GROUP BY user_id, clinic_id, COALESCE(raw_source, 'other'), source_label, channel_group;

CREATE OR REPLACE VIEW public.vw_whatsapp_conversion_real
WITH (security_invoker = true)
AS
WITH wa AS (
  SELECT
    lead_id,
    min(COALESCE(sent_at, created_at)) FILTER (WHERE lower(direction) = 'outbound') AS first_outbound_at,
    min(COALESCE(sent_at, created_at)) FILTER (WHERE lower(direction) = 'inbound') AS first_inbound_at
  FROM public.whatsapp_conversations
  WHERE lead_id IS NOT NULL
  GROUP BY lead_id
), base AS (
  SELECT
    l.user_id,
    l.clinic_id,
    l.id AS lead_id,
    w.first_outbound_at,
    w.first_inbound_at,
    p.journey_appointment_count,
    p.valuation_appointment_date,
    p.treatment_appointment_date,
    p.first_control_appointment_date,
    p.is_new_client,
    p.client_completed_at,
    p.verified_revenue
  FROM wa w
  JOIN public.leads l ON l.id = w.lead_id
  JOIN public.vw_control_centre_pipeline p ON p.lead_id = l.id
  WHERE l.deleted_at IS NULL AND l.merged_into_lead_id IS NULL
)
SELECT
  user_id,
  clinic_id,
  CASE
    WHEN first_outbound_at IS NULL THEN 'not_contacted'
    WHEN first_inbound_at IS NULL THEN 'contacted_no_reply'
    WHEN client_completed_at IS NOT NULL THEN 'client_completed'
    WHEN is_new_client THEN 'control_scheduled'
    WHEN journey_appointment_count >= 2 THEN 'treatment'
    WHEN journey_appointment_count >= 1 AND valuation_appointment_date > CURRENT_DATE THEN 'booked_pending'
    WHEN journey_appointment_count >= 1 THEN 'valuation_completed'
    ELSE 'replied_not_booked'
  END AS cohort,
  count(*) AS lead_count,
  NULL::numeric AS estimated_revenue,
  round(COALESCE(sum(verified_revenue), 0::numeric), 2) AS verified_revenue_crm,
  round(avg(EXTRACT(EPOCH FROM (first_inbound_at - first_outbound_at)) / 60.0)
    FILTER (WHERE first_inbound_at IS NOT NULL AND first_outbound_at IS NOT NULL AND first_inbound_at >= first_outbound_at), 1) AS avg_reply_delay_min
FROM base
GROUP BY user_id, clinic_id,
  CASE
    WHEN first_outbound_at IS NULL THEN 'not_contacted'
    WHEN first_inbound_at IS NULL THEN 'contacted_no_reply'
    WHEN client_completed_at IS NOT NULL THEN 'client_completed'
    WHEN is_new_client THEN 'control_scheduled'
    WHEN journey_appointment_count >= 2 THEN 'treatment'
    WHEN journey_appointment_count >= 1 AND valuation_appointment_date > CURRENT_DATE THEN 'booked_pending'
    WHEN journey_appointment_count >= 1 THEN 'valuation_completed'
    ELSE 'replied_not_booked'
  END;

CREATE OR REPLACE VIEW public.vw_patient_classification_active
WITH (security_invoker = true)
AS
SELECT
  pc.*,
  p.pipeline_stage,
  p.pipeline_stage_source,
  p.journey_appointment_count,
  p.valuation_appointment_date,
  p.treatment_appointment_date,
  p.first_control_appointment_date,
  p.is_new_client,
  p.client_completed_at
FROM public.patient_classification pc
JOIN public.leads l ON l.id = pc.lead_id
JOIN public.vw_control_centre_pipeline p ON p.lead_id = pc.lead_id
WHERE l.deleted_at IS NULL AND l.merged_into_lead_id IS NULL;

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
      COALESCE(l.campaign_name, 'Organic / Unknown')::text AS campaign_name,
      COALESCE(NULLIF(l.utm_source, ''), NULLIF(l.source::text, ''), 'Unknown')::text AS source,
      date_trunc('month', l.created_at) AS month_date,
      l.id AS lead_id,
      p.is_new_client
    FROM public.leads l
    JOIN public.vw_control_centre_pipeline p ON p.lead_id = l.id
    WHERE l.user_id = p_user_id
      AND l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
      AND (p_from = '' OR l.created_at >= p_from::timestamptz)
      AND (p_to = '' OR l.created_at <= (p_to || 'T23:59:59Z')::timestamptz)
      AND (p_source = '' OR COALESCE(NULLIF(l.utm_source, ''), NULLIF(l.source::text, ''), 'Unknown') = p_source)
  )
  SELECT
    t.campaign_name,
    t.source,
    to_char(t.month_date, 'YYYY-MM') AS month,
    count(DISTINCT t.lead_id) AS leads_count,
    count(DISTINCT t.lead_id) FILTER (WHERE t.is_new_client) AS patients_count,
    NULL::numeric AS net_revenue,
    NULL::numeric AS spend,
    NULL::numeric AS cac
  FROM trace t
  GROUP BY t.campaign_name, t.source, t.month_date
  ORDER BY t.month_date DESC, count(DISTINCT t.lead_id) DESC;
$function$;

CREATE OR REPLACE FUNCTION public.nvx_get_dashboard_metrics_v2(
  p_from date DEFAULT (CURRENT_DATE - 30),
  p_to date DEFAULT CURRENT_DATE,
  p_campaign_id text DEFAULT NULL,
  p_source text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_from date := COALESCE(p_from, CURRENT_DATE - 30);
  v_to date := COALESCE(p_to, CURRENT_DATE);
  v_days integer;
  v_prev_from date;
  v_prev_to date;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF v_to < v_from THEN
    RAISE EXCEPTION 'p_to must be on or after p_from';
  END IF;

  SELECT u.clinic_id INTO v_clinic_id FROM public.users u WHERE u.id = v_uid;
  v_days := (v_to - v_from) + 1;
  v_prev_to := v_from - 1;
  v_prev_from := v_prev_to - (v_days - 1);

  WITH scoped AS (
    SELECT
      p.*,
      l.source AS lead_source,
      l.utm_source,
      l.campaign_id AS lead_campaign_id
    FROM public.vw_control_centre_pipeline p
    JOIN public.leads l ON l.id = p.lead_id
    WHERE l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
      AND (
        (v_clinic_id IS NOT NULL AND p.clinic_id = v_clinic_id)
        OR (v_clinic_id IS NULL AND p.user_id = v_uid)
      )
      AND l.created_at::date BETWEEN v_from AND v_to
      AND (p_campaign_id IS NULL OR p_campaign_id = '' OR p_campaign_id = 'ALL' OR COALESCE(p.campaign_id, l.campaign_id) = p_campaign_id)
      AND (p_source IS NULL OR p_source = '' OR p_source = 'ALL' OR COALESCE(NULLIF(l.utm_source, ''), NULLIF(l.source::text, ''), 'unknown') = p_source)
  ), prev_scoped AS (
    SELECT p.*
    FROM public.vw_control_centre_pipeline p
    JOIN public.leads l ON l.id = p.lead_id
    WHERE l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
      AND (
        (v_clinic_id IS NOT NULL AND p.clinic_id = v_clinic_id)
        OR (v_clinic_id IS NULL AND p.user_id = v_uid)
      )
      AND l.created_at::date BETWEEN v_prev_from AND v_prev_to
      AND (p_campaign_id IS NULL OR p_campaign_id = '' OR p_campaign_id = 'ALL' OR COALESCE(p.campaign_id, l.campaign_id) = p_campaign_id)
      AND (p_source IS NULL OR p_source = '' OR p_source = 'ALL' OR COALESCE(NULLIF(l.utm_source, ''), NULLIF(l.source::text, ''), 'unknown') = p_source)
  ), totals AS (
    SELECT
      count(*)::integer AS total_leads,
      count(*) FILTER (WHERE journey_identity_source IS NOT NULL)::integer AS patient_matches,
      count(*) FILTER (WHERE journey_appointment_count >= 1)::integer AS valuation_count,
      count(*) FILTER (WHERE journey_appointment_count >= 2)::integer AS treatment_count,
      count(*) FILTER (WHERE journey_appointment_count >= 3)::integer AS control_count,
      count(*) FILTER (WHERE is_new_client)::integer AS new_clients,
      count(*) FILTER (WHERE client_completed_at IS NOT NULL)::integer AS client_completed,
      round(COALESCE(sum(verified_revenue), 0::numeric), 2) AS verified_revenue
    FROM scoped
  ), prev_totals AS (
    SELECT
      count(*)::integer AS total_leads,
      count(*) FILTER (WHERE journey_identity_source IS NOT NULL)::integer AS patient_matches,
      count(*) FILTER (WHERE is_new_client)::integer AS new_clients
    FROM prev_scoped
  ), by_stage AS (
    SELECT COALESCE(jsonb_object_agg(pipeline_stage, n), '{}'::jsonb) AS data
    FROM (SELECT pipeline_stage, count(*)::integer AS n FROM scoped GROUP BY pipeline_stage) s
  ), by_source AS (
    SELECT COALESCE(jsonb_object_agg(source_name, n), '{}'::jsonb) AS data
    FROM (
      SELECT COALESCE(NULLIF(utm_source, ''), NULLIF(lead_source::text, ''), 'unknown') AS source_name,
             count(*)::integer AS n
      FROM scoped
      GROUP BY 1
    ) s
  ), assembled AS (
    SELECT jsonb_build_object(
      'metrics', jsonb_build_object(
        'totalLeads', t.total_leads,
        'conversionRate', CASE WHEN t.total_leads > 0 THEN round(100.0 * t.new_clients / t.total_leads, 1) ELSE 0 END,
        'patientMatches', t.patient_matches,
        'patientConversionRate', CASE WHEN t.total_leads > 0 THEN round(100.0 * t.patient_matches / t.total_leads, 1) ELSE 0 END,
        'verifiedRevenue', t.verified_revenue,
        'newClients', t.new_clients,
        'clientCompleted', t.client_completed,
        'valuationCount', t.valuation_count,
        'treatmentCount', t.treatment_count,
        'controlCount', t.control_count,
        'byStage', bs.data,
        'bySource', bsrc.data,
        'deltas', jsonb_build_object(
          'leads', CASE WHEN pt.total_leads > 0 THEN round(100.0 * (t.total_leads - pt.total_leads) / pt.total_leads, 1) ELSE NULL END,
          'conversions', CASE WHEN pt.new_clients > 0 THEN round(100.0 * (t.new_clients - pt.new_clients) / pt.new_clients, 1) ELSE NULL END,
          'patientMatches', CASE WHEN pt.patient_matches > 0 THEN round(100.0 * (t.patient_matches - pt.patient_matches) / pt.patient_matches, 1) ELSE NULL END,
          'revenue', NULL
        )
      ),
      'funnel', jsonb_build_array(
        jsonb_build_object('stage','total_leads','label','Leads','count',t.total_leads,'percentage',CASE WHEN t.total_leads > 0 THEN 100 ELSE 0 END),
        jsonb_build_object('stage','valuation','label','1/3 · Valoración','count',t.valuation_count,'percentage',CASE WHEN t.total_leads > 0 THEN round(100.0*t.valuation_count/t.total_leads,1) ELSE 0 END),
        jsonb_build_object('stage','treatment','label','2/3 · Tratamiento','count',t.treatment_count,'percentage',CASE WHEN t.total_leads > 0 THEN round(100.0*t.treatment_count/t.total_leads,1) ELSE 0 END),
        jsonb_build_object('stage','control','label','3/3 · 1er control','count',t.control_count,'percentage',CASE WHEN t.total_leads > 0 THEN round(100.0*t.control_count/t.total_leads,1) ELSE 0 END),
        jsonb_build_object('stage','new_client','label','Clientes nuevos','count',t.new_clients,'percentage',CASE WHEN t.total_leads > 0 THEN round(100.0*t.new_clients/t.total_leads,1) ELSE 0 END)
      ),
      'period', jsonb_build_object('from',v_from,'to',v_to,'previous_from',v_prev_from,'previous_to',v_prev_to),
      'contract', 'canonical_journey_v2'
    ) AS data
    FROM totals t CROSS JOIN prev_totals pt CROSS JOIN by_stage bs CROSS JOIN by_source bsrc
  )
  SELECT data INTO v_result FROM assembled;

  RETURN COALESCE(v_result, jsonb_build_object('metrics', '{}'::jsonb, 'funnel', '[]'::jsonb, 'contract', 'canonical_journey_v2'));
END;
$function$;

REVOKE ALL ON FUNCTION public.nvx_get_dashboard_metrics_v2(date,date,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nvx_get_dashboard_metrics_v2(date,date,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.nvx_get_dashboard_metrics_v2(date,date,text,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.nvx_get_dashboard_metrics_v2(date,date,text,text) IS
'Authenticated Control Centre metrics. Conversion is is_new_client from ordered Doctoralia journey; payment/revenue does not advance clinical stage.';
