-- Atomically finalize a HubSpot-verified web lead reconciliation.
-- This is deliberately separate from the public collector: only service_role can
-- convert browser lineage into a public.leads foreign key and downstream work.

CREATE OR REPLACE FUNCTION public.finalize_web_lead_reconciliation(
  p_attribution_id UUID,
  p_lead_id UUID,
  p_hubspot_contact_id BIGINT,
  p_owner_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attr public.google_click_attributions%ROWTYPE;
  v_lead public.leads%ROWTYPE;
BEGIN
  SELECT * INTO v_attr
  FROM public.google_click_attributions
  WHERE id = p_attribution_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attribution not found';
  END IF;

  IF v_attr.is_test_lead OR v_attr.reconciliation_status = 'qa_suppressed' THEN
    RAISE EXCEPTION 'QA attribution cannot be reconciled';
  END IF;

  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead not found';
  END IF;

  IF v_lead.source <> 'website_hubspot' THEN
    RAISE EXCEPTION 'lead source is not website_hubspot';
  END IF;

  IF v_lead.nvx_lead_id IS NULL OR v_attr.nvx_lead_id IS NULL OR v_lead.nvx_lead_id <> v_attr.nvx_lead_id THEN
    RAISE EXCEPTION 'lead lineage mismatch';
  END IF;

  IF v_lead.hubspot_contact_id IS NULL OR v_lead.hubspot_contact_id <> p_hubspot_contact_id THEN
    RAISE EXCEPTION 'HubSpot contact mismatch';
  END IF;

  IF v_attr.applied_lead_id IS NOT NULL AND v_attr.applied_lead_id <> p_lead_id THEN
    RAISE EXCEPTION 'attribution already applied to another lead';
  END IF;

  UPDATE public.google_click_attributions
  SET
    applied_lead_id = p_lead_id,
    applied_at = COALESCE(applied_at, now()),
    reconciliation_status = 'reconciled',
    reconciliation_error = NULL,
    reconciled_at = COALESCE(reconciled_at, now()),
    last_reconciliation_attempt_at = now()
  WHERE id = p_attribution_id;

  INSERT INTO public.hubspot_deal_projections (
    lead_id,
    hubspot_contact_id,
    pipeline_id,
    stage_id,
    owner_id,
    currency_code,
    projection_status,
    last_error,
    updated_at
  ) VALUES (
    p_lead_id,
    p_hubspot_contact_id,
    '3707782370',
    '5159669951',
    NULLIF(trim(p_owner_id), ''),
    'EUR',
    'pending',
    NULL,
    now()
  )
  ON CONFLICT (lead_id)
  DO UPDATE SET
    hubspot_contact_id = EXCLUDED.hubspot_contact_id,
    pipeline_id = EXCLUDED.pipeline_id,
    owner_id = COALESCE(EXCLUDED.owner_id, public.hubspot_deal_projections.owner_id),
    projection_status = CASE
      WHEN public.hubspot_deal_projections.projection_status = 'suppressed' THEN 'suppressed'
      ELSE 'pending'
    END,
    last_error = NULL,
    updated_at = now();

  PERFORM public.queue_google_data_manager_event(
    p_lead_id,
    'lead',
    v_attr.captured_at,
    NULL,
    'lead:' || p_lead_id::text
  );

  RETURN p_lead_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_web_lead_reconciliation(UUID,UUID,BIGINT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_web_lead_reconciliation(UUID,UUID,BIGINT,TEXT) TO service_role;
