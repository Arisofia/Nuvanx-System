-- =============================================================================
-- Preview/core CRM compatibility tables
--
-- Supabase Preview starts from the migration history only. The production CRM
-- tables were created before this migration set, so preview databases can reach
-- the early analytics views with only meta_daily_insights present. Define the
-- minimal, idempotent table shape those historical migrations expect; production
-- databases keep their existing tables unchanged.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL,
  email TEXT,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  clinic_id UUID,
  external_id TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  source TEXT,
  stage TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_id TEXT,
  ad_name TEXT,
  form_id TEXT,
  form_name TEXT,
  meta_ad_id TEXT,
  meta_ad_name TEXT,
  meta_form_id TEXT,
  meta_platform TEXT,
  asset_url TEXT,
  is_organic BOOLEAN DEFAULT FALSE,
  raw_field_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  email_normalized TEXT,
  phone_normalized TEXT,
  normalized_phone TEXT,
  normalized_name TEXT,
  dni TEXT,
  dni_hash TEXT,
  email_hash TEXT,
  telefono_hash TEXT,
  first_outbound_at TIMESTAMPTZ,
  first_inbound_at TIMESTAMPTZ,
  reply_delay_minutes NUMERIC,
  appointment_status TEXT,
  appointment_date TIMESTAMPTZ,
  attended_at TIMESTAMPTZ,
  no_show_flag BOOLEAN DEFAULT FALSE,
  revenue NUMERIC NOT NULL DEFAULT 0,
  verified_revenue NUMERIC NOT NULL DEFAULT 0,
  treatment_name TEXT,
  converted_patient_id UUID,
  priority TEXT,
  lost_reason TEXT,
  lead_quality_score NUMERIC,
  merged_into_lead_id UUID,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at_meta TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS clinic_id UUID,
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS campaign_name TEXT,
  ADD COLUMN IF NOT EXISTS adset_id TEXT,
  ADD COLUMN IF NOT EXISTS adset_name TEXT,
  ADD COLUMN IF NOT EXISTS ad_id TEXT,
  ADD COLUMN IF NOT EXISTS ad_name TEXT,
  ADD COLUMN IF NOT EXISTS form_id TEXT,
  ADD COLUMN IF NOT EXISTS form_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_ad_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_ad_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_form_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_platform TEXT,
  ADD COLUMN IF NOT EXISTS asset_url TEXT,
  ADD COLUMN IF NOT EXISTS is_organic BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS raw_field_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS email_normalized TEXT,
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT,
  ADD COLUMN IF NOT EXISTS normalized_phone TEXT,
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS dni TEXT,
  ADD COLUMN IF NOT EXISTS dni_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_hash TEXT,
  ADD COLUMN IF NOT EXISTS telefono_hash TEXT,
  ADD COLUMN IF NOT EXISTS first_outbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply_delay_minutes NUMERIC,
  ADD COLUMN IF NOT EXISTS appointment_status TEXT,
  ADD COLUMN IF NOT EXISTS appointment_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_flag BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS revenue NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verified_revenue NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS treatment_name TEXT,
  ADD COLUMN IF NOT EXISTS converted_patient_id UUID,
  ADD COLUMN IF NOT EXISTS priority TEXT,
  ADD COLUMN IF NOT EXISTS lost_reason TEXT,
  ADD COLUMN IF NOT EXISTS lead_quality_score NUMERIC,
  ADD COLUMN IF NOT EXISTS merged_into_lead_id UUID,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at_meta TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.meta_attribution (
  lead_id UUID PRIMARY KEY,
  user_id UUID,
  date DATE,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_id TEXT,
  ad_name TEXT,
  spend NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID,
  name TEXT,
  dni TEXT,
  dni_hash TEXT,
  phone TEXT,
  phone_normalized TEXT,
  total_ltv NUMERIC NOT NULL DEFAULT 0,
  last_visit TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.financial_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID,
  patient_id UUID,
  patient_dni TEXT,
  patient_name TEXT,
  patient_phone TEXT,
  phone_normalized TEXT,
  template_id TEXT,
  template_name TEXT,
  source_system TEXT,
  amount_net NUMERIC NOT NULL DEFAULT 0,
  amount_gross NUMERIC NOT NULL DEFAULT 0,
  intake_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.doctoralia_patients (
  doc_patient_id TEXT NOT NULL,
  clinic_id UUID,
  lead_id UUID,
  full_name TEXT,
  name_norm TEXT,
  phone_primary TEXT,
  phone_secondary TEXT,
  phone_normalized TEXT,
  match_confidence NUMERIC,
  match_class TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (doc_patient_id, clinic_id)
);

CREATE INDEX IF NOT EXISTS leads_user_id_idx ON public.leads(user_id);
CREATE INDEX IF NOT EXISTS leads_clinic_id_idx ON public.leads(clinic_id);
CREATE INDEX IF NOT EXISTS leads_phone_normalized_idx ON public.leads(phone_normalized);
CREATE INDEX IF NOT EXISTS leads_campaign_id_idx ON public.leads(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS meta_attribution_lead_id_idx ON public.meta_attribution(lead_id);
CREATE INDEX IF NOT EXISTS financial_settlements_clinic_id_idx ON public.financial_settlements(clinic_id);
CREATE INDEX IF NOT EXISTS doctoralia_patients_clinic_id_idx ON public.doctoralia_patients(clinic_id);
