-- Harden SECURITY DEFINER RPC Access

-- Create helper function for anonymous session assertion
CREATE OR REPLACE FUNCTION public.nvx_assert_non_anonymous_session()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
    IF (SELECT current_setting('request.jwt.claims', true)::jsonb->>'is_anonymous') = 'true' THEN
        RAISE EXCEPTION 'Anonymous access is not allowed for this operation.';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.nvx_assert_non_anonymous_session() TO authenticated, service_role;

-- Revoke execute from authenticated for internal functions
REVOKE EXECUTE ON FUNCTION public.nvx_get_hubspot_marketing_contact_monitor() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.nvx_get_attribution_health() FROM authenticated;

-- Redeclare with guard
CREATE OR REPLACE FUNCTION public.nvx_get_attribution_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_result jsonb;
BEGIN
    PERFORM public.nvx_assert_non_anonymous_session();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT u.clinic_id INTO v_clinic_id
  FROM public.users u
  WHERE u.id = v_uid;

  WITH active_leads AS (
    SELECT
      l.id,
      l.nvx_lead_id,
      l.source,
      l.gclid,
      l.fbc,
      l.fbp,
      l.utm_source
    FROM public.leads l
    WHERE l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND (
        (v_clinic_id IS NOT NULL AND l.clinic_id = v_clinic_id)
        OR (v_clinic_id IS NULL AND l.user_id = v_uid)
      )
  ), lead_stats AS (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE source = 'website_hubspot')::integer AS website,
      count(*) FILTER (WHERE NULLIF(BTRIM(gclid), '') IS NOT NULL)::integer AS gclid,
      count(*) FILTER (WHERE NULLIF(BTRIM(fbc), '') IS NOT NULL)::integer AS fbc,
      count(*) FILTER (WHERE NULLIF(BTRIM(fbp), '') IS NOT NULL)::integer AS fbp,
      count(*) FILTER (WHERE NULLIF(BTRIM(utm_source), '') IS NOT NULL)::integer AS utm
    FROM active_leads
  ), scoped_captures AS (
    SELECT c.*
    FROM public.web_lead_captures c
    WHERE EXISTS (
      SELECT 1
      FROM active_leads l
      WHERE (c.applied_lead_id IS NOT NULL AND c.applied_lead_id = l.id)
         OR (c.nvx_lead_id IS NOT NULL AND l.nvx_lead_id = c.nvx_lead_id)
    )
  ), capture_stats AS (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE applied_lead_id IS NOT NULL AND reconciliation_status = 'reconciled')::integer AS reconciled,
      count(*) FILTER (WHERE applied_lead_id IS NULL AND reconciliation_status = 'pending')::integer AS pending,
      count(*) FILTER (WHERE COALESCE(is_test_lead, false) OR reconciliation_status LIKE 'qa_suppressed%')::integer AS qa,
      max(captured_at) AS last_capture_at
    FROM scoped_captures
  ), scoped_google AS (
    SELECT g.*
    FROM public.google_click_attributions g
    WHERE EXISTS (
      SELECT 1
      FROM active_leads l
      WHERE (g.applied_lead_id IS NOT NULL AND g.applied_lead_id = l.id)
         OR (g.nvx_lead_id IS NOT NULL AND l.nvx_lead_id = g.nvx_lead_id)
    )
  ), google_stats AS (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE applied_lead_id IS NOT NULL AND reconciliation_status = 'reconciled')::integer AS reconciled,
      count(*) FILTER (
        WHERE applied_lead_id IS NULL
          AND reconciliation_status = 'pending'
          AND NOT COALESCE(is_test_lead, false)
      )::integer AS pending,
      count(*) FILTER (WHERE COALESCE(is_test_lead, false) OR reconciliation_status LIKE 'qa_suppressed%')::integer AS qa,
      max(captured_at) AS last_attribution_at
    FROM scoped_google
  )
  SELECT jsonb_build_object(
    'contract', 'attribution_identity_v1',
    'leads', jsonb_build_object(
      'active', ls.total,
      'websiteHubspot', ls.website,
      'withGclid', ls.gclid,
      'withFbc', ls.fbc,
      'withFbp', ls.fbp,
      'withUtmSource', ls.utm,
      'gclidCoveragePct', CASE WHEN ls.total > 0 THEN round(100.0 * ls.gclid / ls.total, 1) ELSE 0 END,
      'fbcCoveragePct', CASE WHEN ls.total > 0 THEN round(100.0 * ls.fbc / ls.total, 1) ELSE 0 END,
      'fbpCoveragePct', CASE WHEN ls.total > 0 THEN round(100.0 * ls.fbp / ls.total, 1) ELSE 0 END,
      'utmCoveragePct', CASE WHEN ls.total > 0 THEN round(100.0 * ls.utm / ls.total, 1) ELSE 0 END
    ),
    'webCaptures', jsonb_build_object(
      'total', cs.total,
      'reconciled', cs.reconciled,
      'pending', cs.pending,
      'qa', cs.qa,
      'lastCaptureAt', cs.last_capture_at
    ),
    'googleAttribution', jsonb_build_object(
      'total', gs.total,
      'reconciled', gs.reconciled,
      'pending', gs.pending,
      'qa', gs.qa,
      'lastAttributionAt', gs.last_attribution_at
    ),
    'generatedAt', pg_catalog.now()
  ) INTO v_result
  FROM lead_stats ls CROSS JOIN capture_stats cs CROSS JOIN google_stats gs;

  RETURN v_result;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.nvx_get_attribution_health() TO service_role;

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
    PERFORM public.nvx_assert_non_anonymous_session();
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
GRANT EXECUTE ON FUNCTION public.nvx_get_dashboard_metrics_v2(date,date,text,text) TO authenticated;

create or replace function public.nvx_get_control_centre_pipeline(p_limit integer default 200, p_offset integer default 0)
returns setof public.vw_control_centre_pipeline
language sql
security definer
set search_path = ''
as $$
  select v.*
  from public.vw_control_centre_pipeline v
  where (
    v.clinic_id is not distinct from (select u.clinic_id from public.users u where u.id = auth.uid())
    and v.clinic_id is not null
  ) or (
    (select u.clinic_id from public.users u where u.id = auth.uid()) is null
    and v.user_id = auth.uid()
  )
  order by v.stage_evidence_at desc nulls last, v.created_at desc, v.lead_id
  limit greatest(1, least(coalesce(p_limit,200),500))
  offset greatest(coalesce(p_offset,0),0)
$$;
GRANT EXECUTE ON FUNCTION public.nvx_get_control_centre_pipeline(integer,integer) TO authenticated;

create or replace function public.nvx_get_control_centre_lead_timeline(p_lead_id uuid, p_limit integer default 200)
returns setof public.vw_control_centre_lead_timeline
language sql
security definer
set search_path = ''
as $$
  select t.*
  from public.vw_control_centre_lead_timeline t
  join public.leads l on l.id=t.lead_id
  where t.lead_id=p_lead_id
    and l.deleted_at is null
    and (
      (l.clinic_id is not null and l.clinic_id = (select u.clinic_id from public.users u where u.id = auth.uid()))
      or (
        (select u.clinic_id from public.users u where u.id = auth.uid()) is null
        and l.user_id = auth.uid()
      )
    )
  order by t.event_at desc nulls last
  limit greatest(1, least(coalesce(p_limit,200),500))
$$;
GRANT EXECUTE ON FUNCTION public.nvx_get_control_centre_lead_timeline(uuid,integer) TO authenticated;

