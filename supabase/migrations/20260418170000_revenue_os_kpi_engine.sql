-- =============================================================================
-- Nuvanx Revenue Intelligence Platform — KPI Engine + Reporting Layer
-- Phase 1/2/3: schema completions, normalize_email, 6 reporting views,
--              reconcile_lead_to_patient, kpi_blocked catalogue
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SCHEMA COMPLETIONS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attended_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_at   TIMESTAMPTZ;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS form_name VARCHAR(255);

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS email_normalized VARCHAR(255);

ALTER TABLE financial_settlements
  ADD COLUMN IF NOT EXISTS source_system     VARCHAR(32) NOT NULL DEFAULT 'doctoralia',
  ADD COLUMN IF NOT EXISTS intermediary_name VARCHAR(255);

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS conversation_status VARCHAR(32) NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS template_name       VARCHAR(255);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION normalize_email(raw_email TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF raw_email IS NULL THEN RETURN NULL; END IF;
  RETURN LOWER(TRIM(raw_email));
END;
$$;

CREATE OR REPLACE FUNCTION patients_normalize_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    NEW.phone_normalized := normalize_phone(NEW.phone);
  END IF;
  IF NEW.email IS NOT NULL THEN
    NEW.email_normalized := normalize_email(NEW.email);
  END IF;
  IF NEW.dni IS NOT NULL THEN
    NEW.dni_hash := encode(sha256(LOWER(TRIM(NEW.dni))::bytea), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patients_normalize_before_upsert ON patients;
CREATE TRIGGER patients_normalize_before_upsert
  BEFORE INSERT OR UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION patients_normalize_fields();

-- reconcile_lead_to_patient: deterministic join (DNI hash → phone → email)
CREATE OR REPLACE FUNCTION reconcile_lead_to_patient(p_lead_id UUID)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_lead       leads%ROWTYPE;
  v_patient_id UUID;
BEGIN
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_lead.converted_patient_id IS NOT NULL THEN
    RETURN v_lead.converted_patient_id;
  END IF;

  -- Strategy 1: DNI hash
  IF v_lead.dni_hash IS NOT NULL THEN
    SELECT id INTO v_patient_id FROM patients
    WHERE dni_hash = v_lead.dni_hash LIMIT 1;
    IF v_patient_id IS NOT NULL THEN
      UPDATE leads SET converted_patient_id = v_patient_id, updated_at = NOW() WHERE id = p_lead_id;
      RETURN v_patient_id;
    END IF;
  END IF;

  -- Strategy 2: Normalized phone
  IF v_lead.phone_normalized IS NOT NULL THEN
    SELECT id INTO v_patient_id FROM patients
    WHERE phone_normalized = v_lead.phone_normalized LIMIT 1;
    IF v_patient_id IS NOT NULL THEN
      UPDATE leads SET converted_patient_id = v_patient_id, updated_at = NOW() WHERE id = p_lead_id;
      RETURN v_patient_id;
    END IF;
  END IF;

  -- Strategy 3: Normalized email
  IF v_lead.email_normalized IS NOT NULL THEN
    SELECT id INTO v_patient_id FROM patients
    WHERE email_normalized = v_lead.email_normalized LIMIT 1;
    IF v_patient_id IS NOT NULL THEN
      UPDATE leads SET converted_patient_id = v_patient_id, updated_at = NOW() WHERE id = p_lead_id;
      RETURN v_patient_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE financial_settlements
SET source_system = 'doctoralia'
WHERE source_system IS NULL OR source_system = '';

UPDATE patients
SET email_normalized = normalize_email(email)
WHERE email IS NOT NULL AND email_normalized IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REPORTING VIEWS
-- Deferred to migration 20260418180000 which runs after all referenced columns
-- (patients.dni_hash, leads.dni_hash, leads.email_normalized, leads.campaign_id,
-- financial_settlements.template_id, financial_settlements.cancelled_at, etc.)
-- have been added. Creating the views here would fail on a fresh database.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. KPI BLOCKED FLAGS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kpi_blocked (
  kpi_name       VARCHAR(128) PRIMARY KEY,
  kpi_group      VARCHAR(64)  NOT NULL,
  blocked_reason TEXT         NOT NULL,
  required_field TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO kpi_blocked (kpi_name, kpi_group, blocked_reason, required_field) VALUES
  ('doctor_revenue_per_doctor',        'operations',   'No doctors or appointments ingested yet.', 'appointments.doctor_id + doctors rows'),
  ('doctor_attended_rate',             'operations',   'No appointments ingested yet.', 'appointments.status = showed'),
  ('doctor_no_show_rate',              'operations',   'No appointments ingested yet.', 'appointments.status = no_show'),
  ('appointment_booked_by_slot',       'operations',   'No appointment records exist.', 'appointments.start_time'),
  ('lead_acquisition_kpis',            'acquisition',  'No leads ingested. Meta webhook must fire with real leadgen data.', 'leads rows'),
  ('conversion_funnel',                'conversion',   'No leads ingested. All conversion KPIs depend on lead rows.', 'leads rows'),
  ('whatsapp_effectiveness',           'whatsapp',     'No WhatsApp conversations recorded yet.', 'whatsapp_conversations rows'),
  ('reply_delay_median',               'whatsapp',     'No leads with first_inbound_at populated.', 'leads.reply_delay_minutes'),
  ('campaign_roi_settled',             'revenue',      'No leads yet linked to Doctoralia patients via DNI.', 'leads.converted_patient_id + financial_settlements'),
  ('doctoralia_by_acquisition_source', 'revenue',      'No leads linked to Doctoralia patients yet.', 'leads.dni OR leads.phone_normalized matching patients')
ON CONFLICT (kpi_name) DO UPDATE
  SET blocked_reason = EXCLUDED.blocked_reason,
      required_field = EXCLUDED.required_field;
