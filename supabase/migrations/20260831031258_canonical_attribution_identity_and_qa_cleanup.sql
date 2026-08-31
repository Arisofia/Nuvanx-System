-- Canonical Attribution Identity v1
-- 1) Remove only known, unapplied QA Google attribution rows.
-- 2) Make final web-capture reconciliation the single atomic owner of lead attribution enrichment.
-- 3) Expose an authenticated, no-PII attribution health contract for Control Centre.

DO $cleanup$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.google_click_attributions
  WHERE applied_lead_id IS NULL
    AND reconciliation_status = 'pending'
    AND (
      landing_url LIKE 'https://staging2.nuvanx.com/%'
      OR gclid LIKE 'NVXALLOW-%'
      OR gclid LIKE 'NUVANX_QA_%'
      OR gclid LIKE 'TEST_QA_%'
      OR gclid LIKE 'QA-CONSENT-%'
      OR gclid LIKE 'QA-ENRICHMENT-%'
    );

  IF v_count <> 14 THEN
    RAISE EXCEPTION 'Refusing QA attribution cleanup: expected exactly 14 unapplied rows, found %', v_count;
  END IF;

  DELETE FROM public.google_click_attributions
  WHERE applied_lead_id IS NULL
    AND reconciliation_status = 'pending'
    AND (
      landing_url LIKE 'https://staging2.nuvanx.com/%'
      OR gclid LIKE 'NVXALLOW-%'
      OR gclid LIKE 'NUVANX_QA_%'
      OR gclid LIKE 'TEST_QA_%'
      OR gclid LIKE 'QA-CONSENT-%'
      OR gclid LIKE 'QA-ENRICHMENT-%'
    );
END
$cleanup$;

CREATE OR REPLACE FUNCTION public.finalize_web_capture_reconciliation(
  p_capture_id uuid,
  p_lead_id uuid,
  p_hubspot_contact_id bigint,
  p_owner_id text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_capture public.web_lead_captures%rowtype;
  v_lead public.leads%rowtype;
  v_google public.google_click_attributions%rowtype;
  v_google_count integer := 0;
  v_gclid text;
  v_fbc text;
  v_fbp text;
  v_landing_url text;
  v_utm_source text;
  v_utm_medium text;
  v_utm_campaign text;
  v_utm_content text;
  v_utm_term text;
BEGIN
  SELECT * INTO v_capture
  FROM public.web_lead_captures
  WHERE id = p_capture_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Capture not found'; END IF;
  IF v_capture.is_test_lead THEN RAISE EXCEPTION 'QA capture cannot be reconciled'; END IF;

  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id
    AND deleted_at IS NULL
    AND merged_into_lead_id IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found'; END IF;

  IF COALESCE(p_hubspot_contact_id, v_lead.hubspot_contact_id) IS NULL THEN
    RAISE EXCEPTION 'HubSpot contact ID is required for reconciliation';
  END IF;
  IF v_lead.hubspot_contact_id IS DISTINCT FROM p_hubspot_contact_id THEN
    RAISE EXCEPTION 'HubSpot contact mismatch';
  END IF;
  IF v_capture.applied_lead_id IS NOT NULL AND v_capture.applied_lead_id <> p_lead_id THEN
    RAISE EXCEPTION 'Capture already applied to another lead';
  END IF;

  IF v_capture.marketing_consent AND EXISTS (
    SELECT 1
    FROM public.google_click_attributions g
    WHERE g.nvx_lead_id = v_capture.nvx_lead_id
      AND g.applied_lead_id IS NOT NULL
      AND g.applied_lead_id <> p_lead_id
  ) THEN
    RAISE EXCEPTION 'Google attribution lineage conflict';
  END IF;

  IF v_capture.marketing_consent THEN
    SELECT * INTO v_google
    FROM public.google_click_attributions g
    WHERE g.nvx_lead_id = v_capture.nvx_lead_id
      AND COALESCE(g.is_test_lead, false) = false
    ORDER BY g.captured_at ASC, g.id ASC
    LIMIT 1;

    v_gclid := COALESCE(
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'gclid'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'gclid'), ''),
      NULLIF(BTRIM(v_google.gclid), '')
    );
    v_fbc := COALESCE(
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'fbc'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'fbc'), '')
    );
    v_fbp := COALESCE(
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'fbp'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'fbp'), '')
    );
    v_landing_url := COALESCE(
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'landing_url'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'landing_url'), ''),
      NULLIF(BTRIM(v_google.landing_url), '')
    );
    v_utm_source := COALESCE(
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'utm_source'), ''),
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'source'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'utm_source'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'source'), '')
    );
    v_utm_medium := COALESCE(
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'utm_medium'), ''),
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'medium'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'utm_medium'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'medium'), '')
    );
    v_utm_campaign := COALESCE(
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'utm_campaign'), ''),
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'campaign_id'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'utm_campaign'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'campaign_id'), '')
    );
    v_utm_content := COALESCE(
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'utm_content'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'utm_content'), '')
    );
    v_utm_term := COALESCE(
      NULLIF(BTRIM(v_capture.conversion_attribution ->> 'utm_term'), ''),
      NULLIF(BTRIM(v_capture.first_attribution ->> 'utm_term'), '')
    );

    UPDATE public.leads
    SET gclid = COALESCE(NULLIF(BTRIM(gclid), ''), v_gclid),
        fbc = COALESCE(NULLIF(BTRIM(fbc), ''), v_fbc),
        fbp = COALESCE(NULLIF(BTRIM(fbp), ''), v_fbp),
        landing_url = COALESCE(NULLIF(BTRIM(landing_url), ''), v_landing_url),
        utm_source = COALESCE(NULLIF(BTRIM(utm_source), ''), v_utm_source),
        utm_medium = COALESCE(NULLIF(BTRIM(utm_medium), ''), v_utm_medium),
        utm_campaign = COALESCE(NULLIF(BTRIM(utm_campaign), ''), v_utm_campaign),
        utm_content = COALESCE(NULLIF(BTRIM(utm_content), ''), v_utm_content),
        utm_term = COALESCE(NULLIF(BTRIM(utm_term), ''), v_utm_term),
        updated_at = pg_catalog.now()
    WHERE id = p_lead_id;
  END IF;

  UPDATE public.web_lead_captures
  SET applied_lead_id = p_lead_id,
      applied_at = COALESCE(applied_at, pg_catalog.now()),
      reconciliation_status = 'reconciled',
      reconciliation_error = NULL,
      reconciled_at = COALESCE(reconciled_at, pg_catalog.now()),
      last_reconciliation_attempt_at = pg_catalog.now(),
      last_seen_at = pg_catalog.now()
  WHERE id = p_capture_id;

  IF v_capture.marketing_consent THEN
    UPDATE public.google_click_attributions
    SET applied_lead_id = p_lead_id,
        applied_at = COALESCE(applied_at, pg_catalog.now()),
        reconciliation_status = 'reconciled',
        reconciliation_error = NULL,
        reconciled_at = COALESCE(reconciled_at, pg_catalog.now()),
        last_reconciliation_attempt_at = pg_catalog.now()
    WHERE nvx_lead_id = v_capture.nvx_lead_id
      AND COALESCE(is_test_lead, false) = false
      AND (applied_lead_id IS NULL OR applied_lead_id = p_lead_id);
    GET DIAGNOSTICS v_google_count = ROW_COUNT;
  END IF;

  INSERT INTO public.hubspot_deal_projections (
    lead_id, hubspot_contact_id, owner_id, projection_status, updated_at
  ) VALUES (
    p_lead_id, p_hubspot_contact_id, NULLIF(TRIM(p_owner_id), ''), 'pending', pg_catalog.now()
  )
  ON CONFLICT (lead_id) DO UPDATE
  SET hubspot_contact_id = EXCLUDED.hubspot_contact_id,
      owner_id = COALESCE(EXCLUDED.owner_id, public.hubspot_deal_projections.owner_id),
      projection_status = CASE
        WHEN public.hubspot_deal_projections.projection_status = 'suppressed' THEN 'suppressed'
        ELSE 'pending'
      END,
      last_error = NULL,
      updated_at = pg_catalog.now();

  IF v_capture.marketing_consent AND v_google_count > 0 THEN
    PERFORM public.queue_google_data_manager_event(
      p_lead_id,
      'lead',
      COALESCE(v_capture.captured_at, pg_catalog.now()),
      NULL,
      'lead:' || p_lead_id::text
    );
  END IF;

  IF v_capture.marketing_consent AND COALESCE(p_hubspot_contact_id, v_lead.hubspot_contact_id) IS NOT NULL THEN
    INSERT INTO public.meta_capi_outbox (lead_id, event_name, event_id)
    VALUES (p_lead_id, 'Lead', 'lead:' || v_capture.nvx_lead_id::text)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN p_lead_id;
END;
$function$;

COMMENT ON FUNCTION public.finalize_web_capture_reconciliation(uuid,uuid,bigint,text) IS
'Atomic web-lead finalization. Applies consented acquisition identity to null lead attribution fields, reconciles Google lineage, and queues downstream events. Never overwrites existing attribution and never changes clinical stage/revenue.';

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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT u.clinic_id INTO v_clinic_id
  FROM public.users u
  WHERE u.id = v_uid;

  WITH active_leads AS (
    SELECT l.*
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
  ), capture_stats AS (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE applied_lead_id IS NOT NULL AND reconciliation_status = 'reconciled')::integer AS reconciled,
      count(*) FILTER (WHERE applied_lead_id IS NULL AND reconciliation_status = 'pending')::integer AS pending,
      count(*) FILTER (WHERE is_test_lead OR reconciliation_status LIKE 'qa_suppressed%')::integer AS qa,
      max(captured_at) AS last_capture_at
    FROM public.web_lead_captures
  ), google_stats AS (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE applied_lead_id IS NOT NULL AND reconciliation_status = 'reconciled')::integer AS reconciled,
      count(*) FILTER (WHERE applied_lead_id IS NULL AND reconciliation_status = 'pending' AND NOT is_test_lead)::integer AS pending,
      count(*) FILTER (WHERE is_test_lead OR reconciliation_status LIKE 'qa_suppressed%')::integer AS qa,
      max(captured_at) AS last_attribution_at
    FROM public.google_click_attributions
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

REVOKE ALL ON FUNCTION public.nvx_get_attribution_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nvx_get_attribution_health() FROM anon;
GRANT EXECUTE ON FUNCTION public.nvx_get_attribution_health() TO authenticated, service_role;

COMMENT ON FUNCTION public.nvx_get_attribution_health() IS
'Authenticated no-PII acquisition identity health for Control Centre. Reports only aggregate coverage and ledger freshness.';
