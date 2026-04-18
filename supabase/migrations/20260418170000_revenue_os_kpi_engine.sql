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
-- ─────────────────────────────────────────────────────────────────────────────

-- Full source-to-cash row per lead (LATERAL takes most recent settlement)
CREATE OR REPLACE VIEW vw_lead_traceability AS
SELECT
  l.id                    AS lead_id,
  l.name                  AS lead_name,
  l.email_normalized,
  l.phone_normalized,
  l.source,
  l.stage,
  l.campaign_id,
  l.campaign_name,
  l.adset_id,
  l.adset_name,
  l.ad_id,
  l.ad_name,
  l.form_id,
  l.form_name,
  l.created_at            AS lead_created_at,
  l.first_outbound_at,
  l.first_inbound_at,
  l.reply_delay_minutes,
  l.appointment_status,
  l.attended_at,
  l.no_show_flag,
  l.revenue               AS estimated_revenue,
  l.verified_revenue      AS crm_verified_revenue,
  l.lost_reason,
  p.id                    AS patient_id,
  p.total_ltv             AS patient_ltv,
  fs.id                   AS settlement_id,
  fs.template_id          AS doctoralia_template_id,
  fs.template_name        AS doctoralia_template_name,
  fs.amount_net           AS doctoralia_net,
  fs.amount_gross         AS doctoralia_gross,
  fs.settled_at           AS settlement_date,
  fs.intake_at            AS settlement_intake_date,
  fs.source_system        AS settlement_source
FROM leads l
LEFT JOIN patients p
  ON  (p.dni_hash = l.dni_hash AND l.dni_hash IS NOT NULL)
  OR  p.id = l.converted_patient_id
LEFT JOIN LATERAL (
  SELECT *
  FROM financial_settlements sub_fs
  WHERE sub_fs.patient_id = p.id
    AND sub_fs.cancelled_at IS NULL
  ORDER BY sub_fs.settled_at DESC
  LIMIT 1
) fs ON TRUE;

-- Full funnel by campaign (all rate KPIs, no fake data)
CREATE OR REPLACE VIEW vw_campaign_performance_real AS
SELECT
  COALESCE(l.campaign_name, 'Organic / Unknown') AS campaign_name,
  l.campaign_id,
  COUNT(*)                                        AS total_leads,
  COUNT(*) FILTER (WHERE l.first_outbound_at IS NOT NULL)                            AS contacted,
  COUNT(*) FILTER (WHERE l.first_inbound_at  IS NOT NULL)                            AS replied,
  COUNT(*) FILTER (WHERE l.appointment_status IN ('scheduled','confirmed','showed'))  AS booked,
  COUNT(*) FILTER (WHERE l.appointment_status = 'showed')                            AS attended,
  COUNT(*) FILTER (WHERE l.no_show_flag = TRUE)                                      AS no_shows,
  COUNT(*) FILTER (WHERE l.stage = 'closed')                                         AS closed,
  COUNT(*) FILTER (WHERE l.verified_revenue > 0)                                     AS closed_won,
  ROUND(COALESCE(SUM(l.revenue), 0), 2)           AS estimated_revenue,
  ROUND(COALESCE(SUM(l.verified_revenue), 0), 2)  AS verified_revenue_crm,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE l.first_inbound_at IS NOT NULL) /
    NULLIF(COUNT(*) FILTER (WHERE l.first_outbound_at IS NOT NULL), 0), 1
  ) AS reply_rate_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE l.appointment_status IN ('scheduled','confirmed','showed')) /
    NULLIF(COUNT(*) FILTER (WHERE l.first_inbound_at IS NOT NULL), 0), 1
  ) AS replied_to_booked_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE l.stage = 'closed') / NULLIF(COUNT(*), 0), 1
  ) AS lead_to_close_rate_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE l.no_show_flag = TRUE) /
    NULLIF(COUNT(*) FILTER (WHERE l.appointment_status IS NOT NULL), 0), 1
  ) AS no_show_rate_pct,
  ROUND(AVG(l.reply_delay_minutes), 1) AS avg_reply_delay_min,
  MIN(l.created_at)                    AS first_lead_at,
  MAX(l.created_at)                    AS last_lead_at
FROM leads l
GROUP BY l.campaign_name, l.campaign_id;

-- WhatsApp engagement cohort analysis
CREATE OR REPLACE VIEW vw_whatsapp_conversion_real AS
SELECT
  CASE
    WHEN first_outbound_at IS NULL                           THEN 'not_contacted'
    WHEN first_inbound_at  IS NULL                           THEN 'contacted_no_reply'
    WHEN appointment_status IS NULL AND stage != 'closed'    THEN 'replied_not_booked'
    WHEN appointment_status IN ('scheduled','confirmed')     THEN 'booked_pending'
    WHEN appointment_status = 'showed' AND verified_revenue > 0 THEN 'attended_closed'
    WHEN appointment_status = 'showed'                       THEN 'attended_not_closed'
    WHEN no_show_flag = TRUE                                 THEN 'no_show'
    WHEN stage = 'closed'                                    THEN 'closed_no_appointment'
    ELSE                                                          'replied_other'
  END                                               AS cohort,
  COUNT(*)                                          AS lead_count,
  ROUND(COALESCE(SUM(revenue), 0), 2)              AS estimated_revenue,
  ROUND(COALESCE(SUM(verified_revenue), 0), 2)     AS verified_revenue_crm,
  ROUND(AVG(reply_delay_minutes), 1)               AS avg_reply_delay_min
FROM leads
GROUP BY 1;

-- Doctoralia: by template × month
CREATE OR REPLACE VIEW vw_doctoralia_financials AS
SELECT
  template_id,
  template_name,
  DATE_TRUNC('month', settled_at)                                           AS settled_month,
  COUNT(*)                                                                  AS operations_count,
  COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL)                          AS cancellation_count,
  ROUND(SUM(amount_gross)    FILTER (WHERE cancelled_at IS NULL), 2)        AS total_gross,
  ROUND(SUM(amount_discount) FILTER (WHERE cancelled_at IS NULL), 2)        AS total_discount,
  ROUND(SUM(amount_net)      FILTER (WHERE cancelled_at IS NULL), 2)        AS total_net,
  ROUND(AVG(amount_net)      FILTER (WHERE cancelled_at IS NULL), 2)        AS avg_ticket_net,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1
  ) AS cancellation_rate_pct,
  ROUND(
    100.0 * SUM(amount_discount) FILTER (WHERE cancelled_at IS NULL) /
    NULLIF(SUM(amount_gross) FILTER (WHERE cancelled_at IS NULL), 0), 1
  ) AS discount_rate_pct,
  ROUND(
    AVG(EXTRACT(EPOCH FROM (settled_at - intake_at)) / 86400.0)
    FILTER (WHERE intake_at IS NOT NULL AND cancelled_at IS NULL), 1
  ) AS avg_liquidation_lag_days,
  source_system
FROM financial_settlements
GROUP BY template_id, template_name, DATE_TRUNC('month', settled_at), source_system;

-- Doctoralia: monthly rollup
CREATE OR REPLACE VIEW vw_doctoralia_by_month AS
SELECT
  DATE_TRUNC('month', settled_at)                                           AS settled_month,
  COUNT(*)                                                                  AS operations_count,
  COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL)                          AS cancellation_count,
  ROUND(SUM(amount_gross)    FILTER (WHERE cancelled_at IS NULL), 2)        AS total_gross,
  ROUND(SUM(amount_discount) FILTER (WHERE cancelled_at IS NULL), 2)        AS total_discount,
  ROUND(SUM(amount_net)      FILTER (WHERE cancelled_at IS NULL), 2)        AS total_net,
  ROUND(AVG(amount_net)      FILTER (WHERE cancelled_at IS NULL), 2)        AS avg_ticket_net,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1
  ) AS cancellation_rate_pct,
  ROUND(
    100.0 * SUM(amount_discount) FILTER (WHERE cancelled_at IS NULL) /
    NULLIF(SUM(amount_gross) FILTER (WHERE cancelled_at IS NULL), 0), 1
  ) AS discount_rate_pct,
  ROUND(
    AVG(EXTRACT(EPOCH FROM (settled_at - intake_at)) / 86400.0)
    FILTER (WHERE intake_at IS NOT NULL AND cancelled_at IS NULL), 1
  ) AS avg_liquidation_lag_days
FROM financial_settlements
GROUP BY DATE_TRUNC('month', settled_at);

-- Doctor performance (returns real data when appointments are ingested)
CREATE OR REPLACE VIEW vw_doctor_performance_real AS
SELECT
  d.id                  AS doctor_id,
  d.name                AS doctor_name,
  d.specialty,
  d.is_active,
  COUNT(a.id)           AS total_appointments,
  COUNT(a.id) FILTER (WHERE a.status = 'showed')    AS attended_count,
  COUNT(a.id) FILTER (WHERE a.status = 'no_show')   AS no_show_count,
  COUNT(a.id) FILTER (WHERE a.status = 'cancelled') AS cancelled_count,
  COUNT(a.id) FILTER (WHERE a.status = 'confirmed') AS confirmed_count,
  ROUND(
    100.0 * COUNT(a.id) FILTER (WHERE a.status = 'showed') / NULLIF(COUNT(a.id), 0), 1
  ) AS attended_rate_pct,
  ROUND(
    100.0 * COUNT(a.id) FILTER (WHERE a.status = 'no_show') / NULLIF(COUNT(a.id), 0), 1
  ) AS no_show_rate_pct,
  ROUND(COALESCE(SUM(l.revenue), 0), 2)          AS estimated_revenue,
  ROUND(COALESCE(SUM(l.verified_revenue), 0), 2) AS verified_revenue_crm
FROM doctors d
LEFT JOIN appointments a ON a.doctor_id = d.id
LEFT JOIN patients p ON p.id = a.patient_id
LEFT JOIN leads l ON l.converted_patient_id = p.id
GROUP BY d.id, d.name, d.specialty, d.is_active;

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
