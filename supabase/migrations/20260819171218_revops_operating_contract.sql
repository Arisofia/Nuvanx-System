-- NUVANX Revenue Operating Contract v1
-- Additive schema only. Existing Meta lead identity remains untouched.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS nvx_lead_id UUID,
  ADD COLUMN IF NOT EXISTS hubspot_contact_id BIGINT,
  ADD COLUMN IF NOT EXISTS hubspot_deal_id BIGINT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_sla_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS appointment_source TEXT,
  ADD COLUMN IF NOT EXISTS appointment_external_id TEXT,
  ADD COLUMN IF NOT EXISTS appointment_matched_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_nvx_lead_id_unique
  ON public.leads (nvx_lead_id)
  WHERE nvx_lead_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_hubspot_contact_id_unique
  ON public.leads (hubspot_contact_id)
  WHERE hubspot_contact_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_first_response_at
  ON public.leads (first_response_at)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_first_response_sla_minutes_check'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_first_response_sla_minutes_check
      CHECK (first_response_sla_minutes BETWEEN 1 AND 1440);
  END IF;
END $$;

-- first_response_at is the timestamp of the first human outbound response/attempt.
-- first_inbound_at remains the patient's first reply; reply_delay_minutes keeps its
-- existing meaning and is not repurposed by this migration.
UPDATE public.leads
SET first_response_at = first_outbound_at
WHERE first_response_at IS NULL
  AND first_outbound_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.nvx_sync_first_response_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.first_outbound_at IS NOT NULL THEN
    IF NEW.first_response_at IS NULL OR NEW.first_outbound_at < NEW.first_response_at THEN
      NEW.first_response_at := NEW.first_outbound_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nvx_sync_first_response_at ON public.leads;
CREATE TRIGGER trg_nvx_sync_first_response_at
BEFORE INSERT OR UPDATE OF first_outbound_at, first_response_at ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.nvx_sync_first_response_at();

CREATE OR REPLACE VIEW public.vw_lead_sla
WITH (security_invoker = true)
AS
SELECT
  l.id AS lead_id,
  l.user_id,
  l.clinic_id,
  l.source,
  l.created_at AS lead_created_at,
  l.first_response_at,
  l.first_response_sla_minutes,
  l.created_at + make_interval(mins => l.first_response_sla_minutes) AS response_due_at,
  CASE
    WHEN l.first_response_at IS NULL AND now() <= l.created_at + make_interval(mins => l.first_response_sla_minutes) THEN 'pending'
    WHEN l.first_response_at IS NULL THEN 'breached'
    WHEN l.first_response_at <= l.created_at + make_interval(mins => l.first_response_sla_minutes) THEN 'met'
    ELSE 'breached'
  END AS sla_status,
  CASE
    WHEN l.first_response_at IS NULL THEN NULL
    ELSE ROUND((EXTRACT(EPOCH FROM (l.first_response_at - l.created_at)) / 60.0)::numeric, 2)
  END AS first_response_minutes
FROM public.leads l
WHERE l.deleted_at IS NULL;

ALTER TABLE public.google_click_attributions
  ADD COLUMN IF NOT EXISTS is_test_lead BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS test_run_id TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reconciliation_error TEXT,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reconciliation_attempt_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'google_click_attributions_reconciliation_status_check'
      AND conrelid = 'public.google_click_attributions'::regclass
  ) THEN
    ALTER TABLE public.google_click_attributions
      ADD CONSTRAINT google_click_attributions_reconciliation_status_check
      CHECK (reconciliation_status IN ('pending','qa_suppressed','verified','reconciled','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_google_click_reconciliation_pending
  ON public.google_click_attributions (captured_at)
  WHERE applied_lead_id IS NULL AND reconciliation_status = 'pending';

CREATE TABLE IF NOT EXISTS public.hubspot_deal_projections (
  lead_id UUID PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  hubspot_contact_id BIGINT NOT NULL,
  hubspot_deal_id BIGINT UNIQUE,
  pipeline_id TEXT NOT NULL DEFAULT '3707782370',
  stage_id TEXT NOT NULL DEFAULT '5159669951',
  owner_id TEXT,
  amount NUMERIC,
  currency_code TEXT NOT NULL DEFAULT 'EUR',
  projection_status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  projected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hubspot_deal_projections_status_check
    CHECK (projection_status IN ('pending','creating','created','updating','failed','suppressed')),
  CONSTRAINT hubspot_deal_projections_currency_check
    CHECK (currency_code ~ '^[A-Z]{3}$')
);

ALTER TABLE public.hubspot_deal_projections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hubspot_deal_projections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hubspot_deal_projections TO service_role;

CREATE TABLE IF NOT EXISTS public.google_data_manager_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  attribution_id UUID REFERENCES public.google_click_attributions(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL,
  operating_customer_id TEXT,
  conversion_action_id TEXT,
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  email_hash TEXT,
  phone_hash TEXT,
  conversion_value NUMERIC,
  currency_code TEXT NOT NULL DEFAULT 'EUR',
  transaction_id TEXT NOT NULL,
  is_test_lead BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider_request_id TEXT,
  diagnostics JSONB,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT google_data_manager_outbox_transaction_unique UNIQUE (transaction_id),
  CONSTRAINT google_data_manager_outbox_delivery_status_check
    CHECK (delivery_status IN ('pending','sending','sent','failed','suppressed','configuration_required')),
  CONSTRAINT google_data_manager_outbox_currency_check
    CHECK (currency_code ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_google_data_manager_lead_event_unique
  ON public.google_data_manager_outbox (lead_id, event_name);
CREATE INDEX IF NOT EXISTS idx_google_data_manager_pending
  ON public.google_data_manager_outbox (created_at)
  WHERE delivery_status IN ('pending','failed');

ALTER TABLE public.google_data_manager_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_data_manager_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.google_data_manager_outbox TO service_role;

CREATE TABLE IF NOT EXISTS public.lead_appointment_matches (
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  appointment_ingestion_id UUID NOT NULL REFERENCES public.doctoralia_appointments_ingestion(id) ON DELETE CASCADE,
  match_method TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, appointment_ingestion_id),
  CONSTRAINT lead_appointment_matches_method_check
    CHECK (match_method IN ('phone_normalized','phone_hash'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_appointment_primary_unique
  ON public.lead_appointment_matches (lead_id)
  WHERE is_primary;

ALTER TABLE public.lead_appointment_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_appointment_matches FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_appointment_matches TO service_role;

-- Doctoralia Appointment Engine. Matching is deterministic and uses the existing
-- normalized phone/hash model. It preserves the live stage vocabulary
-- (lead / appointment / convertido); attendance and no-show state live in their
-- dedicated appointment fields rather than inventing extra lead stages.
CREATE OR REPLACE FUNCTION public.refresh_doctoralia_appointment_engine(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  DELETE FROM public.lead_appointment_matches lam
  USING public.leads l
  WHERE lam.lead_id = l.id
    AND l.user_id = p_user_id;

  WITH scoped_user AS (
    SELECT u.id AS user_id, u.clinic_id
    FROM public.users u
    WHERE u.id = p_user_id
  ),
  candidate_matches AS (
    SELECT
      l.id AS lead_id,
      a.id AS appointment_id,
      CASE
        WHEN l.phone_normalized IS NOT NULL
          AND l.phone_normalized <> ''
          AND (
            a.phone_normalized = l.phone_normalized
            OR RIGHT(regexp_replace(a.phone_normalized, '[^0-9]', '', 'g'), 9)
             = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
          ) THEN 'phone_normalized'
        ELSE 'phone_hash'
      END AS match_method,
      a.appointment_date,
      a.appointment_time,
      a.estado,
      a.source_key,
      ROW_NUMBER() OVER (
        PARTITION BY l.id
        ORDER BY a.appointment_date ASC,
                 COALESCE(NULLIF(a.appointment_time, ''), '23:59') ASC,
                 a.sheet_row ASC
      ) AS rn
    FROM public.leads l
    JOIN scoped_user su
      ON (
        (su.clinic_id IS NOT NULL AND l.clinic_id = su.clinic_id)
        OR (su.clinic_id IS NULL AND l.user_id = su.user_id)
      )
    JOIN public.doctoralia_appointments_ingestion a
      ON a.is_control = FALSE
     AND a.is_cancelled = FALSE
     AND a.appointment_date >= (l.created_at AT TIME ZONE 'Europe/Madrid')::date
     AND (
       (
         l.phone_normalized IS NOT NULL
         AND l.phone_normalized <> ''
         AND a.phone_normalized IS NOT NULL
         AND (
           a.phone_normalized = l.phone_normalized
           OR RIGHT(regexp_replace(a.phone_normalized, '[^0-9]', '', 'g'), 9)
            = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
         )
       )
       OR (
         l.telefono_hash IS NOT NULL
         AND l.telefono_hash <> ''
         AND a.phone_normalized IS NOT NULL
         AND encode(extensions.digest(public.normalize_phone(a.phone_normalized), 'sha256'), 'hex') = l.telefono_hash
       )
     )
    WHERE l.deleted_at IS NULL
      AND l.user_id = p_user_id
  ),
  inserted AS (
    INSERT INTO public.lead_appointment_matches (
      lead_id,
      appointment_ingestion_id,
      match_method,
      is_primary
    )
    SELECT lead_id, appointment_id, match_method, rn = 1
    FROM candidate_matches
    ON CONFLICT (lead_id, appointment_ingestion_id)
    DO UPDATE SET
      match_method = EXCLUDED.match_method,
      is_primary = EXCLUDED.is_primary,
      matched_at = now()
    RETURNING lead_id
  ),
  primary_match AS (
    SELECT
      cm.lead_id,
      cm.appointment_date,
      cm.appointment_time,
      cm.estado,
      cm.source_key
    FROM candidate_matches cm
    WHERE cm.rn = 1
  ),
  updated AS (
    UPDATE public.leads l
    SET
      appointment_date = CASE
        WHEN pm.appointment_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]'
          THEN (pm.appointment_date + substring(pm.appointment_time from 1 for 5)::time) AT TIME ZONE 'Europe/Madrid'
        ELSE pm.appointment_date::timestamp AT TIME ZONE 'Europe/Madrid'
      END,
      appointment_status = CASE
        WHEN lower(pm.estado) IN ('realizada','pagada') THEN 'attended'
        WHEN lower(pm.estado) = 'no acude' THEN 'no_show'
        ELSE 'scheduled'
      END,
      attended_at = CASE
        WHEN lower(pm.estado) IN ('realizada','pagada') THEN
          CASE
            WHEN pm.appointment_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]'
              THEN (pm.appointment_date + substring(pm.appointment_time from 1 for 5)::time) AT TIME ZONE 'Europe/Madrid'
            ELSE pm.appointment_date::timestamp AT TIME ZONE 'Europe/Madrid'
          END
        ELSE l.attended_at
      END,
      no_show_flag = lower(pm.estado) = 'no acude',
      appointment_source = 'doctoralia',
      appointment_external_id = pm.source_key,
      appointment_matched_at = now(),
      stage = CASE
        WHEN l.stage = 'convertido' THEN l.stage
        WHEN l.stage = 'lead' THEN 'appointment'
        ELSE l.stage
      END,
      updated_at = now()
    FROM primary_match pm
    WHERE l.id = pm.lead_id
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated;

  RETURN COALESCE(updated_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_doctoralia_appointment_engine(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_doctoralia_appointment_engine(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_google_data_manager_event(
  p_lead_id UUID,
  p_event_name TEXT,
  p_event_timestamp TIMESTAMPTZ DEFAULT now(),
  p_conversion_value NUMERIC DEFAULT NULL,
  p_transaction_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attr public.google_click_attributions%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_id UUID;
  v_transaction_id TEXT;
BEGIN
  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead not found';
  END IF;

  SELECT * INTO v_attr
  FROM public.google_click_attributions
  WHERE applied_lead_id = p_lead_id
    AND reconciliation_status = 'reconciled'
    AND is_test_lead = FALSE
  ORDER BY captured_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no reconciled non-QA attribution for lead';
  END IF;

  v_transaction_id := COALESCE(NULLIF(trim(p_transaction_id), ''), p_event_name || ':' || p_lead_id::text);

  INSERT INTO public.google_data_manager_outbox (
    lead_id,
    attribution_id,
    event_name,
    event_timestamp,
    gclid,
    gbraid,
    wbraid,
    email_hash,
    phone_hash,
    conversion_value,
    currency_code,
    transaction_id,
    is_test_lead,
    delivery_status
  ) VALUES (
    p_lead_id,
    v_attr.id,
    p_event_name,
    p_event_timestamp,
    v_attr.gclid,
    v_attr.gbraid,
    v_attr.wbraid,
    v_lead.email_hash,
    v_lead.telefono_hash,
    p_conversion_value,
    'EUR',
    v_transaction_id,
    FALSE,
    'pending'
  )
  ON CONFLICT (transaction_id)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_google_data_manager_event(UUID,TEXT,TIMESTAMPTZ,NUMERIC,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_google_data_manager_event(UUID,TEXT,TIMESTAMPTZ,NUMERIC,TEXT) TO service_role;
