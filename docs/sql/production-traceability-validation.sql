-- Production traceability validation checklist.
-- Run this file in the Supabase SQL editor after production migrations finish.
-- Copy the numeric outputs into the release note before approving KPIs that rely
-- on Lead Audit / Traceability / Doctoralia matching.

-- 1) Confirm the production relations created or refreshed by the latest migrations.
SELECT
  to_regclass('public.produccion_intermediarios') AS produccion_intermediarios_relation,
  to_regclass('public.vw_lead_traceability') AS vw_lead_traceability_relation;

-- 2) Confirm no legacy traceability view is accidentally present for operators to query.
SELECT
  to_regclass('public.vw_lead_traceability_old') AS legacy_vw_lead_traceability_old_relation;

-- 3) Leads: cobertura de phone_normalized.
SELECT
  COUNT(*) AS total_leads,
  COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL AND phone_normalized <> '') AS leads_con_phone
FROM public.leads;

-- 4) Patients: cobertura de phone_normalized.
SELECT
  COUNT(*) AS total_pacientes,
  COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL AND phone_normalized <> '') AS pacientes_con_phone
FROM public.patients;

-- 5) Doctoralia patients: cobertura de phone_normalized.
SELECT
  COUNT(*) AS total_doc_pacientes,
  COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL AND phone_normalized <> '') AS doc_pacientes_con_phone
FROM public.doctoralia_patients;

-- 6) Current matching coverage in the canonical traceability view.
SELECT
  COUNT(*) AS total_leads,
  COUNT(*) FILTER (WHERE patient_name IS NOT NULL) AS leads_con_paciente,
  COUNT(*) FILTER (WHERE doctoralia_template_id IS NOT NULL) AS leads_con_settlement,
  COUNT(*) FILTER (WHERE doc_patient_id IS NOT NULL) AS leads_con_doc_patient
FROM public.vw_lead_traceability;

-- 7) Optional: review examples where leads have a normalized phone but no match.
SELECT
  lead_id,
  lead_created_at,
  campaign_name,
  source,
  phone_normalized
FROM public.vw_lead_traceability
WHERE phone_normalized IS NOT NULL
  AND phone_normalized <> ''
  AND patient_name IS NULL
  AND doctoralia_template_id IS NULL
  AND doc_patient_id IS NULL
ORDER BY lead_created_at DESC
LIMIT 25;

-- 8) Doctoralia campaign aggregation check (30-day window).
SELECT * FROM public.get_campaigns_filter(
  (CURRENT_DATE - INTERVAL '30 days')::DATE,
  CURRENT_DATE
);

-- 9) Quality check: produccion_intermediarios phone extraction quality.
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL AND phone_normalized <> '') AS rows_with_phone,
  COUNT(*) FILTER (WHERE asunto IS NOT NULL AND asunto <> '') AS rows_with_asunto
FROM public.produccion_intermediarios;
