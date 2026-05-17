-- =============================================================================
-- MASTER TRACEABILITY: Unified Leads and Production View
--
-- This migration refines the extraction functions to be ultra-robust 
-- (handling multiple phones, varied name positions, and treatment labels)
-- and creates the final Master View for ROI analysis.
-- =============================================================================

BEGIN;

-- 1. Refine SQL Extraction Functions for "Asunto" Field
-- Format: "<id>. <FULL NAME> [<phone1> - <phone2>] (<treatment>)"

-- Improved Patient ID extraction (numbers before first dot)
CREATE OR REPLACE FUNCTION public.extract_produccion_intermediarios_doc_patient_id(p_asunto TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  -- Match digits at the start of the string followed by a dot
  RETURN (regexp_match(p_asunto, '^(\d+)\.'))[1];
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Improved Name extraction (text between ID. and [)
CREATE OR REPLACE FUNCTION public.extract_produccion_intermediarios_name(p_asunto TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_name TEXT;
BEGIN
  -- Match everything between "ID. " and the first "["
  v_name := (regexp_match(p_asunto, '^\d+\.\s+([^\[]+?)\s*(?:\[|$)'))[1];
  
  -- If there are no brackets, just take everything after the ID
  IF v_name IS NULL THEN
    v_name := (regexp_match(p_asunto, '^\d+\.\s+(.+)$'))[1];
  END IF;

  RETURN btrim(v_name);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Improved Treatment extraction (last text inside parentheses)
CREATE OR REPLACE FUNCTION public.extract_produccion_intermediarios_treatment(p_asunto TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  -- Match content of the LAST parentheses in the string
  -- Regex: find '(' followed by any non-')' followed by ')' at the end, allowing for trailing spaces
  RETURN btrim((regexp_match(p_asunto, '\(([^)]+)\)\s*$'))[1]);
EXCEPTION WHEN OTHERS THEN
  -- Fallback: if no trailing parens, check for any parens
  RETURN btrim((regexp_match(p_asunto, '\(([^)]+)\)'))[1]);
END;
$$;

-- 2. Create the Master Traceability View (No Mock Data)
-- This view performs the actual phone-based match between Meta and Drive data.

CREATE OR REPLACE VIEW public.master_pacientes_trazabilidad AS
WITH leads_clean AS (
  -- Deduplicate leads by phone to avoid multiplying rows in the master table
  -- Priority to the most recent lead
  SELECT DISTINCT ON (phone_normalized)
    id,
    name,
    email_normalized,
    phone_normalized,
    source,
    campaign_name,
    ad_name,
    form_name,
    created_at,
    clinic_id
  FROM public.leads
  WHERE phone_normalized IS NOT NULL 
    AND phone_normalized <> ''
    AND deleted_at IS NULL
  ORDER BY phone_normalized, created_at DESC
)
SELECT 
  -- Lead Acquisition Data
  l.id AS lead_id,
  l.name AS lead_name_meta,
  l.source AS lead_source,
  l.campaign_name AS meta_campaign,
  l.form_name AS meta_form,
  l.created_at AS meta_lead_date,

  -- Production / Clinical Data
  pi.doc_patient_id,
  pi.paciente_nombre AS patient_name_clinical,
  pi.phone_normalized,
  pi.fecha AS appointment_date,
  pi.hora AS appointment_time,
  pi.estado AS appointment_status,
  pi.procedimiento_nombre AS treatment_name,
  pi.importe AS actual_revenue,
  pi.agenda AS doctor_agenda,
  pi.procedencia AS clinical_source,
  
  -- Performance Metrics
  (pi.fecha::date - l.created_at::date) AS days_to_conversion
FROM leads_clean l
INNER JOIN public.produccion_intermediarios pi 
  ON l.phone_normalized = pi.phone_normalized
  AND l.clinic_id = pi.clinic_id
ORDER BY pi.fecha DESC, l.created_at DESC;

COMMENT ON VIEW public.master_pacientes_trazabilidad IS 
'Master Table linking Meta Acquisition (leads) with Doctoralia Production (produccion_intermediarios) via phone matching.';

-- 3. Ensure trigger is active and robust
CREATE OR REPLACE FUNCTION public.fn_extract_and_normalize_produccion_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Phone normalization (already handles brackets and 9-digit local)
  NEW.phone_normalized := public.extract_produccion_intermediarios_phone(NEW.asunto);
  
  -- Identity extraction
  NEW.doc_patient_id       := public.extract_produccion_intermediarios_doc_patient_id(NEW.asunto);
  NEW.paciente_nombre      := public.extract_produccion_intermediarios_name(NEW.asunto);
  NEW.procedimiento_nombre := public.extract_produccion_intermediarios_treatment(NEW.asunto);
  
  RETURN NEW;
END;
$$;

COMMIT;
