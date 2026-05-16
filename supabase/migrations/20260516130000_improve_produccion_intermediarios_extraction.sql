-- =============================================================================
-- Improve Produccion Intermediarios extraction quality
--
-- Adds columns and functions to extract patient name, ID, and treatment 
-- from the Doctoralia 'asunto' field.
-- =============================================================================

BEGIN;

-- 1. Add new columns to public.produccion_intermediarios
ALTER TABLE public.produccion_intermediarios
  ADD COLUMN IF NOT EXISTS doc_patient_id TEXT,
  ADD COLUMN IF NOT EXISTS paciente_nombre TEXT,
  ADD COLUMN IF NOT EXISTS procedimiento_nombre TEXT;

-- 2. Create functions for granular extraction from asunto
-- Format: "<id>. <FULL NAME> [<phone>] (<treatment>)"

-- Extract Doctoralia Patient ID
CREATE OR REPLACE FUNCTION public.extract_produccion_intermediarios_doc_patient_id(p_asunto TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN (regexp_matches(p_asunto, '^(\d+)\.'))[1];
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Extract Patient Full Name
CREATE OR REPLACE FUNCTION public.extract_produccion_intermediarios_name(p_asunto TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  -- Extracts text between the leading "ID. " and the opening bracket "["
  RETURN btrim((regexp_matches(p_asunto, '^\d+\.\s+(.+?)\s+\['))[1]);
EXCEPTION WHEN OTHERS THEN
  -- Fallback: try to extract everything between ID and brackets if possible
  RETURN NULL;
END;
$$;

-- Extract Treatment Name
CREATE OR REPLACE FUNCTION public.extract_produccion_intermediarios_treatment(p_asunto TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  -- Extracts text inside the last parentheses "(...)"
  RETURN btrim((regexp_matches(p_asunto, '\(([^)]+)\)\s*$'))[1]);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- 3. Update the main trigger function to populate all fields
CREATE OR REPLACE FUNCTION public.fn_extract_and_normalize_produccion_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Existing phone extraction
  NEW.phone_normalized := public.extract_produccion_intermediarios_phone(NEW.asunto);
  
  -- New data quality extractions
  NEW.doc_patient_id      := public.extract_produccion_intermediarios_doc_patient_id(NEW.asunto);
  NEW.paciente_nombre     := public.extract_produccion_intermediarios_name(NEW.asunto);
  NEW.procedimiento_nombre := public.extract_produccion_intermediarios_treatment(NEW.asunto);
  
  RETURN NEW;
END;
$$;

-- 4. Apply to existing data
UPDATE public.produccion_intermediarios
SET 
  phone_normalized     = public.extract_produccion_intermediarios_phone(asunto),
  doc_patient_id        = public.extract_produccion_intermediarios_doc_patient_id(asunto),
  paciente_nombre       = public.extract_produccion_intermediarios_name(asunto),
  procedimiento_nombre  = public.extract_produccion_intermediarios_treatment(asunto)
WHERE asunto IS NOT NULL;

COMMIT;
