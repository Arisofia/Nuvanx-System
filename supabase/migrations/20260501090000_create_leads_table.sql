-- 20260501090000_create_leads_table.sql
-- Ensure leads base table exists before traceability views and downstream ALTER migrations.

CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  user_id UUID,
  external_id TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  phone_normalized TEXT,
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
  revenue NUMERIC(12,2),
  verified_revenue NUMERIC(12,2),
  appointment_status TEXT,
  attended_at TIMESTAMPTZ,
  no_show_flag BOOLEAN DEFAULT FALSE,
  converted_patient_id UUID,
  priority TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  inserted_at TIMESTAMPTZ DEFAULT now()
);

-- Preview/core-schema compatibility: production carries public.users remotely,
-- but fresh Supabase Preview databases replay only repository migrations. Provide
-- the minimal columns referenced by historical attribution/traceability SQL.
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
