-- =============================================================================
-- Nuvanx Revenue Intelligence Platform — Revenue OS Foundation
-- Phase 3: Exact Operating Schema (Day 1)
-- =============================================================================

-- 1. Enums & Domains
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
        CREATE TYPE appointment_status AS ENUM ('scheduled', 'confirmed', 'showed', 'no_show', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lost_reason') THEN
        CREATE TYPE lost_reason AS ENUM ('price_too_high', 'location', 'no_response', 'competitor', 'not_ready', 'fake_lead', 'other');
    END IF;
END $$;

-- 2. Table: patients (Master Identity)
CREATE TABLE IF NOT EXISTS patients (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID          NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  dni          VARCHAR(32)   UNIQUE, -- The "Golden Key"
  name         VARCHAR(255)  NOT NULL,
  email        VARCHAR(255),
  phone        VARCHAR(64),
  total_ltv    NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_visit   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS patients_clinic_dni_idx ON patients(clinic_id, dni);
CREATE INDEX IF NOT EXISTS patients_clinic_phone_idx ON patients(clinic_id, phone);

-- 3. Table: doctors (Clinical Staff)
CREATE TABLE IF NOT EXISTS doctors (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID          NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name         VARCHAR(255)  NOT NULL,
  specialty    VARCHAR(128),
  is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 4. Table: treatment_types (Product Catalog)
CREATE TABLE IF NOT EXISTS treatment_types (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID          NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name           VARCHAR(255)  NOT NULL,
  category       VARCHAR(64), -- e.g., 'injectables', 'laser'
  base_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(12,2) NOT NULL DEFAULT 0, -- Used for EBITDA proxy
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 5. Table: appointments (Lifecycle)
CREATE TABLE IF NOT EXISTS appointments (
  id                UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID               NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id        UUID               NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id         UUID               REFERENCES doctors(id) ON DELETE SET NULL,
  treatment_type_id UUID               REFERENCES treatment_types(id) ON DELETE SET NULL,
  start_time        TIMESTAMPTZ        NOT NULL,
  end_time          TIMESTAMPTZ,
  status            appointment_status NOT NULL DEFAULT 'scheduled',
  notes             TEXT,
  created_at        TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS appointments_clinic_date_idx ON appointments(clinic_id, start_time);

-- 6. Table: financial_settlements (Verified Revenue - Doctoralia Ingestion)
CREATE TABLE IF NOT EXISTS financial_settlements (
  id                VARCHAR(64)   PRIMARY KEY, -- External Op ID (from Doctoralia)
  clinic_id         UUID          NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id        UUID          REFERENCES patients(id) ON DELETE SET NULL,
  amount_gross      NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_discount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_net        NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method    VARCHAR(64),  -- e.g., 'Financed', 'Cash'
  template_name     VARCHAR(255), -- from Doctoralia 'plantilladescr'
  settled_at        TIMESTAMPTZ   NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS settlements_clinic_date_idx ON financial_settlements(clinic_id, settled_at);

-- 7. Update leads table (Operating Hooks)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS dni VARCHAR(32),
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lost_reason lost_reason,
  ADD COLUMN IF NOT EXISTS converted_patient_id UUID REFERENCES patients(id) ON DELETE SET NULL;

-- 8. Enable RLS on all new tables
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_settlements ENABLE ROW LEVEL SECURITY;

-- 9. Generic Clinic-Scoped Select Policy for all new tables
-- (Service role continues to bypass)
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY patients_select_clinic ON patients FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt()->>'clinic_id')::uuid);

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
CREATE POLICY doctors_select_clinic ON doctors FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt()->>'clinic_id')::uuid);

ALTER TABLE public.treatment_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY treatment_types_select_clinic ON treatment_types FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt()->>'clinic_id')::uuid);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointments_select_clinic ON appointments FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt()->>'clinic_id')::uuid);

ALTER TABLE public.financial_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY settlements_select_clinic ON financial_settlements FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt()->>'clinic_id')::uuid);

-- 10. Triggers for updated_at
CREATE TRIGGER set_patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
