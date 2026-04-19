-- =============================================================================
-- Nuvanx Revenue Intelligence Platform — KPI Column Completions
-- Adds all columns that the KPI views and webhook handler depend on but were
-- not yet present on the leads, patients, and financial_settlements tables.
-- Also:
--   • defines normalize_phone() (referenced by patients_normalize_fields
--     trigger created in the previous migration but never defined)
--   • adds leads_normalize_fields() trigger
--   • creates meta_attribution table (used by the webhook handler)
--   • re-creates all KPI views now that all referenced columns exist
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LEADS — missing KPI and attribution columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS phone_normalized    TEXT,
  ADD COLUMN IF NOT EXISTS email_normalized    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS dni_hash            VARCHAR(128),
  ADD COLUMN IF NOT EXISTS verified_revenue    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_outbound_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_inbound_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply_delay_minutes NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS appointment_status  VARCHAR(32),
  ADD COLUMN IF NOT EXISTS attended_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_flag        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS campaign_id         VARCHAR(128),
  ADD COLUMN IF NOT EXISTS campaign_name       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS adset_id            VARCHAR(128),
  ADD COLUMN IF NOT EXISTS adset_name          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ad_id               VARCHAR(128),
  ADD COLUMN IF NOT EXISTS ad_name             VARCHAR(255),
  ADD COLUMN IF NOT EXISTS form_id             VARCHAR(128);

CREATE INDEX IF NOT EXISTS leads_phone_normalized_idx ON leads (user_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_dni_hash_idx ON leads (user_id, dni_hash)
  WHERE dni_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_campaign_id_idx ON leads (user_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PATIENTS — missing normalization columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT,
  ADD COLUMN IF NOT EXISTS dni_hash         VARCHAR(128);

-- Clinic-scoped unique constraint on (clinic_id, dni) — required by the
-- Doctoralia ingest ON CONFLICT clause.  The global UNIQUE on dni remains
-- for backward compatibility but we add a partial clinic-scoped one so that
-- the same DNI can appear in different clinics without cross-clinic collisions.
CREATE UNIQUE INDEX IF NOT EXISTS patients_clinic_dni_uq ON patients (clinic_id, dni)
  WHERE dni IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS patients_clinic_dni_hash_uq ON patients (clinic_id, dni_hash)
  WHERE dni_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS patients_phone_normalized_idx ON patients (clinic_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FINANCIAL_SETTLEMENTS — missing columns for view/ingest
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE financial_settlements
  ADD COLUMN IF NOT EXISTS template_id  VARCHAR(64),
  ADD COLUMN IF NOT EXISTS intake_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS settlements_template_idx ON financial_settlements (clinic_id, template_id)
  WHERE template_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. META_ATTRIBUTION — stores webhook attribution data per lead
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meta_attribution (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID         REFERENCES leads(id) ON DELETE CASCADE,
  leadgen_id    VARCHAR(128) NOT NULL,
  page_id       VARCHAR(128),
  form_id       VARCHAR(128),
  campaign_id   VARCHAR(128),
  campaign_name VARCHAR(255),
  adset_id      VARCHAR(128),
  adset_name    VARCHAR(255),
  ad_id         VARCHAR(128),
  ad_name       VARCHAR(255),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (leadgen_id)
);

CREATE INDEX IF NOT EXISTS meta_attribution_lead_id_idx ON meta_attribution (lead_id);

ALTER TABLE meta_attribution ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_attribution_service_role ON meta_attribution;
CREATE POLICY meta_attribution_service_role ON meta_attribution
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- normalize_phone: strip non-digits and normalise Spanish +34/0034 prefix
CREATE OR REPLACE FUNCTION normalize_phone(raw_phone TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF raw_phone IS NULL OR raw_phone = '' THEN RETURN NULL; END IF;
  -- Remove every character that is not a digit
  cleaned := regexp_replace(raw_phone, '[^0-9]', '', 'g');
  -- Strip Spanish country code:
  --   +34XXXXXXXXX  → after stripping non-digits: 34XXXXXXXXX  → 11 digits, starts with '34'
  --   0034XXXXXXXXX → after stripping non-digits: 0034XXXXXXXXX → 13 digits, starts with '0034'
  IF length(cleaned) = 11 AND left(cleaned, 2) = '34' THEN
    cleaned := right(cleaned, 9);
  ELSIF length(cleaned) = 13 AND left(cleaned, 4) = '0034' THEN
    cleaned := right(cleaned, 9);
  END IF;
  IF length(cleaned) < 7 THEN RETURN NULL; END IF;
  RETURN cleaned;
END;
$$;

-- leads_normalize_fields: auto-populate phone_normalized, email_normalized, dni_hash
CREATE OR REPLACE FUNCTION leads_normalize_fields()
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

DROP TRIGGER IF EXISTS leads_normalize_before_upsert ON leads;
CREATE TRIGGER leads_normalize_before_upsert
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_normalize_fields();

-- reconcile_patient_leads: given a patient id, find every unlinked lead that
-- matches by dni_hash or phone_normalized and call reconcile_lead_to_patient
-- on each one.  Used by the Doctoralia ingest endpoint after upserting a
-- patient row so that existing CRM leads are linked immediately.
-- Returns the count of leads reconciled.
CREATE OR REPLACE FUNCTION reconcile_patient_leads(p_patient_id UUID)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_patient    patients%ROWTYPE;
  v_lead_id    UUID;
  v_count      INTEGER := 0;
BEGIN
  SELECT * INTO v_patient FROM patients WHERE id = p_patient_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR v_lead_id IN
    SELECT id FROM leads
    WHERE converted_patient_id IS NULL
      AND (
        (v_patient.dni_hash IS NOT NULL      AND dni_hash        = v_patient.dni_hash)
        OR (v_patient.phone_normalized IS NOT NULL AND phone_normalized = v_patient.phone_normalized)
      )
  LOOP
    PERFORM reconcile_lead_to_patient(v_lead_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. BACKFILL existing rows
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE leads
SET
  phone_normalized = normalize_phone(phone),
  email_normalized = normalize_email(email),
  dni_hash = CASE WHEN dni IS NOT NULL THEN encode(sha256(LOWER(TRIM(dni))::bytea), 'hex') ELSE NULL END
WHERE (phone_normalized IS NULL AND phone IS NOT NULL)
   OR (email_normalized IS NULL AND email IS NOT NULL)
   OR (dni_hash IS NULL AND dni IS NOT NULL);

UPDATE patients
SET
  phone_normalized = normalize_phone(phone),
  dni_hash = CASE WHEN dni IS NOT NULL THEN encode(sha256(LOWER(TRIM(dni))::bytea), 'hex') ELSE NULL END
WHERE (phone_normalized IS NULL AND phone IS NOT NULL)
   OR (dni_hash IS NULL AND dni IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RE-CREATE VIEWS (now all referenced columns exist)
-- These views were created in 20260418170000 but would have failed if
-- the columns didn't exist at that point.  Replacing them here is safe
-- because CREATE OR REPLACE VIEW is idempotent for compatible output columns.
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

-- Doctor performance
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
