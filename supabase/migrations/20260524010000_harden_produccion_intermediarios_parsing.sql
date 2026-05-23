BEGIN;

-- Harden extraction logic for asunto variants such as:
--   "1234. NAME [PHONE] (TREATMENT)"
--   "O/1. NAME [PHONE] (TREATMENT)"
-- and fallback cases without brackets.

CREATE OR REPLACE FUNCTION public.extract_produccion_intermediarios_doc_patient_id(p_asunto TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_match TEXT[];
BEGIN
  IF p_asunto IS NULL OR btrim(p_asunto) = '' THEN
    RETURN NULL;
  END IF;

  -- Accept optional prefixes like O/ before numeric ID.
  v_match := regexp_match(p_asunto, '^(?:[A-Za-z]+/)?(\d+)\.\s*');
  IF v_match IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_match[1];
END;
$$;

CREATE OR REPLACE FUNCTION public.extract_produccion_intermediarios_name(p_asunto TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF p_asunto IS NULL OR btrim(p_asunto) = '' THEN
    RETURN NULL;
  END IF;

  -- Primary pattern: ID prefix + NAME + [phones]
  v_name := (regexp_match(p_asunto, '^(?:[A-Za-z]+/)?\d+\.\s+(.+?)\s+\['))[1];

  -- Fallback: ID prefix + NAME + (treatment)
  IF v_name IS NULL THEN
    v_name := (regexp_match(p_asunto, '^(?:[A-Za-z]+/)?\d+\.\s+(.+?)\s*\('))[1];
  END IF;

  -- Fallback: ID prefix + rest of text
  IF v_name IS NULL THEN
    v_name := (regexp_match(p_asunto, '^(?:[A-Za-z]+/)?\d+\.\s+(.+)$'))[1];
  END IF;

  RETURN NULLIF(btrim(v_name), '');
END;
$$;

-- Recompute extracted columns for historical rows.
UPDATE public.produccion_intermediarios
SET
  doc_patient_id = public.extract_produccion_intermediarios_doc_patient_id(asunto),
  paciente_nombre = public.extract_produccion_intermediarios_name(asunto),
  procedimiento_nombre = public.extract_produccion_intermediarios_treatment(asunto)
WHERE asunto IS NOT NULL;

COMMIT;
