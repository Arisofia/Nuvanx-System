-- =============================================================================
-- Meta CRM Conversion Leads: hold-only stage outbox contract
-- Date: 2026-08-20
--
-- Purpose
--   Capture FUTURE Meta Lead Ads lifecycle transitions durably without sending
--   any request to Meta. Provider event-name mapping remains intentionally unset
--   until one controlled CAPI v2 test proves the exact stage representation used
--   by the canonical dataset in Events Manager / Ads Manager.
--
-- Canonical identity
--   public.meta_attribution.leadgen_id -> public.meta_attribution.lead_id
--   -> public.leads.id
--
-- Privacy / safety
--   * Stores no email, phone, treatment, diagnosis, message, URL path or other PII.
--   * Does not backfill historical rows.
--   * Does not call Graph API, web-events, CAPI Gateway, WordPress or SiteGround.
--   * Rows are created as status='held', mapping_status='unmapped' only.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.meta_crm_conversion_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id uuid NOT NULL REFERENCES public.leads(id),
    leadgen_id text NOT NULL,
    stage_key text NOT NULL,
    provider_event_name text,
    mapping_status text NOT NULL DEFAULT 'unmapped',
    event_time timestamptz NOT NULL DEFAULT now(),
    source_signal text NOT NULL,
    status text NOT NULL DEFAULT 'held',
    hold_reason text NOT NULL DEFAULT 'awaiting_capi_v2_stage_mapping_validation',
    attempt_count integer NOT NULL DEFAULT 0,
    provider_request_id text,
    last_error text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT meta_crm_conversion_outbox_stage_key_check
      CHECK (stage_key IN ('lead', 'appointment_scheduled', 'qualified', 'closed_won')),
    CONSTRAINT meta_crm_conversion_outbox_mapping_status_check
      CHECK (mapping_status IN ('unmapped', 'mapped')),
    CONSTRAINT meta_crm_conversion_outbox_provider_mapping_check
      CHECK (
        (mapping_status = 'unmapped' AND provider_event_name IS NULL) OR
        (mapping_status = 'mapped' AND NULLIF(trim(provider_event_name), '') IS NOT NULL)
      ),
    CONSTRAINT meta_crm_conversion_outbox_status_check
      CHECK (status IN ('held', 'pending', 'sent', 'failed', 'suppressed')),
    CONSTRAINT meta_crm_conversion_outbox_attempt_count_check
      CHECK (attempt_count >= 0),
    CONSTRAINT meta_crm_conversion_outbox_leadgen_nonempty_check
      CHECK (length(trim(leadgen_id)) > 0),
    CONSTRAINT meta_crm_conversion_outbox_unique_stage
      UNIQUE (leadgen_id, stage_key)
);

COMMENT ON TABLE public.meta_crm_conversion_outbox IS
  'Hold-only outbox for future Meta CRM/Conversion Leads stage transitions. This migration implements no provider delivery.';
COMMENT ON COLUMN public.meta_crm_conversion_outbox.leadgen_id IS
  'Original Meta Lead Ads leadgen_id from public.meta_attribution; canonical Meta identity key.';
COMMENT ON COLUMN public.meta_crm_conversion_outbox.stage_key IS
  'NUVANX internal lifecycle stage. Provider-facing naming is deliberately decoupled.';
COMMENT ON COLUMN public.meta_crm_conversion_outbox.provider_event_name IS
  'NULL until a controlled CAPI v2 test validates the provider-facing stage/event representation.';
COMMENT ON COLUMN public.meta_crm_conversion_outbox.mapping_status IS
  'unmapped by default. Delivery cannot be enabled until an explicit mapping is approved.';
COMMENT ON COLUMN public.meta_crm_conversion_outbox.status IS
  'held by default. A later explicitly approved delivery change may transition mapped rows to pending.';

CREATE INDEX IF NOT EXISTS idx_meta_crm_conversion_outbox_status_created
  ON public.meta_crm_conversion_outbox (status, created_at);
CREATE INDEX IF NOT EXISTS idx_meta_crm_conversion_outbox_lead_id
  ON public.meta_crm_conversion_outbox (lead_id);
CREATE INDEX IF NOT EXISTS idx_meta_crm_conversion_outbox_mapping_status
  ON public.meta_crm_conversion_outbox (mapping_status, created_at);

ALTER TABLE public.meta_crm_conversion_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meta_crm_conversion_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.meta_crm_conversion_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.nvx_enqueue_meta_crm_stage(
  p_lead_id uuid,
  p_stage_key text,
  p_event_time timestamptz DEFAULT now(),
  p_source_signal text DEFAULT 'unspecified'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_leadgen_id text;
BEGIN
  IF p_lead_id IS NULL OR p_stage_key IS NULL THEN
    RETURN false;
  END IF;

  IF p_stage_key NOT IN ('lead', 'appointment_scheduled', 'qualified', 'closed_won') THEN
    RETURN false;
  END IF;

  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Internal semantics are strict and independent from provider naming.
  -- In particular, stage='convertido' is NOT treated as a sale;
  -- closed_won requires verified revenue > 0.
  IF p_stage_key = 'appointment_scheduled' AND v_lead.appointment_date IS NULL THEN
    RETURN false;
  ELSIF p_stage_key = 'qualified' AND v_lead.stage::text IS DISTINCT FROM 'convertido' THEN
    RETURN false;
  ELSIF p_stage_key = 'closed_won' AND COALESCE(v_lead.verified_revenue, 0) <= 0 THEN
    RETURN false;
  END IF;

  SELECT ma.leadgen_id
    INTO v_leadgen_id
  FROM public.meta_attribution ma
  WHERE ma.lead_id = p_lead_id
    AND NULLIF(trim(ma.leadgen_id), '') IS NOT NULL
  ORDER BY ma.captured_at DESC NULLS LAST, ma.leadgen_id
  LIMIT 1;

  IF v_leadgen_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.meta_crm_conversion_outbox (
    lead_id,
    leadgen_id,
    stage_key,
    provider_event_name,
    mapping_status,
    event_time,
    source_signal,
    status,
    hold_reason
  ) VALUES (
    p_lead_id,
    v_leadgen_id,
    p_stage_key,
    NULL,
    'unmapped',
    COALESCE(p_event_time, now()),
    COALESCE(NULLIF(trim(p_source_signal), ''), 'unspecified'),
    'held',
    'awaiting_capi_v2_stage_mapping_validation'
  )
  ON CONFLICT (leadgen_id, stage_key) DO NOTHING;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_enqueue_meta_crm_stage(uuid, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_enqueue_meta_crm_stage(uuid, text, timestamptz, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.nvx_meta_crm_on_attribution_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.lead_id IS NULL OR NULLIF(trim(NEW.leadgen_id), '') IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.nvx_enqueue_meta_crm_stage(
      NEW.lead_id,
      'lead',
      COALESCE(NEW.captured_at, now()),
      'meta_attribution_linked'
    );
  ELSIF OLD.lead_id IS DISTINCT FROM NEW.lead_id THEN
    PERFORM public.nvx_enqueue_meta_crm_stage(
      NEW.lead_id,
      'lead',
      COALESCE(NEW.captured_at, now()),
      'meta_attribution_linked'
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_meta_crm_on_attribution_link() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_meta_crm_attribution_link ON public.meta_attribution;
CREATE TRIGGER trg_meta_crm_attribution_link
  AFTER INSERT OR UPDATE OF lead_id ON public.meta_attribution
  FOR EACH ROW
  EXECUTE FUNCTION public.nvx_meta_crm_on_attribution_link();

CREATE OR REPLACE FUNCTION public.nvx_meta_crm_on_lead_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.appointment_date IS NULL AND NEW.appointment_date IS NOT NULL THEN
    PERFORM public.nvx_enqueue_meta_crm_stage(
      NEW.id,
      'appointment_scheduled',
      now(),
      'appointment_date_set'
    );
  END IF;

  IF OLD.stage IS DISTINCT FROM NEW.stage AND NEW.stage::text = 'convertido' THEN
    PERFORM public.nvx_enqueue_meta_crm_stage(
      NEW.id,
      'qualified',
      now(),
      'stage_convertido'
    );
  END IF;

  IF COALESCE(OLD.verified_revenue, 0) <= 0
     AND COALESCE(NEW.verified_revenue, 0) > 0 THEN
    PERFORM public.nvx_enqueue_meta_crm_stage(
      NEW.id,
      'closed_won',
      now(),
      'verified_revenue_positive'
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_meta_crm_on_lead_transition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_meta_crm_lead_transition ON public.leads;
CREATE TRIGGER trg_meta_crm_lead_transition
  AFTER UPDATE OF appointment_date, stage, verified_revenue, deleted_at ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.nvx_meta_crm_on_lead_transition();

-- IMPORTANT: Deliberately no INSERT ... SELECT backfill is present here.
-- Existing historical Meta attribution rows must not generate retroactive events
-- because their true stage-transition timestamps are not known.

COMMIT;
