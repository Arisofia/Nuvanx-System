-- Close review findings on Canonical Metrics v2.
-- 1) The scheduled Doctoralia refresh must use the same safe matcher as the canonical pipeline.
-- 2) Campaign filtering must resolve Meta campaign IDs from meta_attribution too.

CREATE OR REPLACE FUNCTION public.refresh_doctoralia_appointment_engine(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Canonical scheduled entrypoint. Do not delete/rebuild matches and do not mutate
  -- leads.stage, appointment_date, attended_at or revenue. The safe matcher only
  -- creates primary evidence links that satisfy active-lead, identity uniqueness,
  -- cancellation and post-capture boundaries.
  RETURN public.match_leads_to_doctoralia_by_phone(p_user_id);
END;
$function$;

COMMENT ON FUNCTION public.refresh_doctoralia_appointment_engine(uuid) IS
'Canonical scheduled Doctoralia refresh. Delegates to evidence-only match_leads_to_doctoralia_by_phone(uuid); never rewrites legacy lead stage/revenue/appointment fields.';

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
      COALESCE(ma.campaign_id, p.campaign_id, l.campaign_id)::text AS resolved_campaign_id
    FROM public.vw_control_centre_pipeline p
    JOIN public.leads l ON l.id = p.lead_id
    LEFT JOIN public.meta_attribution ma ON ma.lead_id = l.id
    WHERE l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
      AND (
        (v_clinic_id IS NOT NULL AND p.clinic_id = v_clinic_id)
        OR (v_clinic_id IS NULL AND p.user_id = v_uid)
      )
      AND l.created_at::date BETWEEN v_from AND v_to
      AND (
        p_campaign_id IS NULL OR p_campaign_id = '' OR p_campaign_id = 'ALL'
        OR COALESCE(ma.campaign_id, p.campaign_id, l.campaign_id)::text = p_campaign_id
      )
      AND (
        p_source IS NULL OR p_source = '' OR p_source = 'ALL'
        OR COALESCE(NULLIF(l.utm_source, ''), NULLIF(l.source::text, ''), 'unknown') = p_source
      )
  ), prev_scoped AS (
    SELECT
      p.*,
      l.source AS lead_source,
      l.utm_source,
      COALESCE(ma.campaign_id, p.campaign_id, l.campaign_id)::text AS resolved_campaign_id
    FROM public.vw_control_centre_pipeline p
    JOIN public.leads l ON l.id = p.lead_id
    LEFT JOIN public.meta_attribution ma ON ma.lead_id = l.id
    WHERE l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
      AND (
        (v_clinic_id IS NOT NULL AND p.clinic_id = v_clinic_id)
        OR (v_clinic_id IS NULL AND p.user_id = v_uid)
      )
      AND l.created_at::date BETWEEN v_prev_from AND v_prev_to
      AND (
        p_campaign_id IS NULL OR p_campaign_id = '' OR p_campaign_id = 'ALL'
        OR COALESCE(ma.campaign_id, p.campaign_id, l.campaign_id)::text = p_campaign_id
      )
      AND (
        p_source IS NULL OR p_source = '' OR p_source = 'ALL'
        OR COALESCE(NULLIF(l.utm_source, ''), NULLIF(l.source::text, ''), 'unknown') = p_source
      )
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
'Authenticated canonical Control Centre metrics. Campaign filters resolve Meta attribution first; conversion is Doctoralia journey evidence and revenue never advances stage.';
