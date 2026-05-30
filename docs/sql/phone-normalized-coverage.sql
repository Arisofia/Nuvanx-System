-- Phone normalization coverage checks for Lead Audit / Doctoralia matching.
-- Run these statements directly in the Supabase SQL editor.
--
-- Purpose: Quick visibility into how many records have a usable phone_normalized value.
-- This is critical for Doctoralia matching and CAPI quality.
--
-- For the full production release checklist, use: docs/sql/production-traceability-validation.sql

-- Leads: cobertura de phone_normalized
SELECT
  COUNT(*) AS total_leads,
  COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL AND phone_normalized <> '') AS leads_con_phone
FROM public.leads;

-- Patients: cobertura de phone_normalized
SELECT
  COUNT(*) AS total_pacientes,
  COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL AND phone_normalized <> '') AS pacientes_con_phone
FROM public.patients;

-- Doctoralia patients: cobertura de phone_normalized
SELECT
  COUNT(*) AS total_doc_pacientes,
  COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL AND phone_normalized <> '') AS doc_pacientes_con_phone
FROM public.doctoralia_patients;
