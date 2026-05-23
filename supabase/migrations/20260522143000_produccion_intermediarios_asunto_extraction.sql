-- 20260522143000_produccion_intermediarios_asunto_extraction.sql
-- Advanced extraction of structured fields from Doctoralia "asunto" in
-- public.produccion_intermediarios.

ALTER TABLE public.produccion_intermediarios
  ADD COLUMN IF NOT EXISTS paciente_nombre TEXT,
  ADD COLUMN IF NOT EXISTS tratamiento_nombre TEXT,
  ADD COLUMN IF NOT EXISTS doctoralia_id TEXT;

CREATE OR REPLACE FUNCTION public.fn_process_asunto_details()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  m_id TEXT[];
  m_nombre TEXT[];
  m_phone TEXT[];
  m_trat TEXT[];
  raw_phone TEXT;
BEGIN
  IF NEW.asunto IS NULL OR btrim(NEW.asunto) = '' THEN
    NEW.doctoralia_id := NULL;
    NEW.paciente_nombre := NULL;
    NEW.tratamiento_nombre := NULL;
    NEW.phone_normalized := NULL;
    NEW.doc_patient_id := NULL;
    NEW.procedimiento_nombre := NULL;
    RETURN NEW;
  END IF;

  m_id := regexp_match(NEW.asunto, '^\s*([0-9]+)\.');
  NEW.doctoralia_id := CASE WHEN m_id IS NOT NULL THEN m_id[1] ELSE NULL END;

  m_nombre := regexp_match(NEW.asunto, '\.\s*([^\[]+)');
  NEW.paciente_nombre := CASE WHEN m_nombre IS NOT NULL THEN btrim(m_nombre[1]) ELSE NULL END;

  m_phone := regexp_match(NEW.asunto, '\[([^\]]+)\]');
  IF m_phone IS NOT NULL THEN
    raw_phone := regexp_replace(split_part(m_phone[1], '-', 1), '[^0-9]', '', 'g');
    NEW.phone_normalized := NULLIF(public.normalize_phone(raw_phone), '');
  ELSE
    NEW.phone_normalized := NULL;
  END IF;

  m_trat := regexp_match(NEW.asunto, '\(([^)]*)\)\s*$');
  NEW.tratamiento_nombre := CASE WHEN m_trat IS NOT NULL THEN btrim(m_trat[1]) ELSE NULL END;

  NEW.doc_patient_id := NEW.doctoralia_id;
  NEW.procedimiento_nombre := NEW.tratamiento_nombre;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_normalize_phone_doctoralia ON public.produccion_intermediarios;
DROP TRIGGER IF EXISTS tr_process_doctoralia_asunto ON public.produccion_intermediarios;

CREATE TRIGGER tr_process_doctoralia_asunto
BEFORE INSERT OR UPDATE OF asunto
ON public.produccion_intermediarios
FOR EACH ROW
EXECUTE FUNCTION public.fn_process_asunto_details();

UPDATE public.produccion_intermediarios t
SET
  doctoralia_id = m.doctoralia_id,
  paciente_nombre = m.paciente_nombre,
  phone_normalized = m.phone_normalized,
  tratamiento_nombre = m.tratamiento_nombre,
  doc_patient_id = m.doctoralia_id,
  procedimiento_nombre = m.tratamiento_nombre
FROM (
  SELECT
    id,
    CASE WHEN m_id IS NOT NULL THEN m_id[1] ELSE NULL END AS doctoralia_id,
    CASE WHEN m_nombre IS NOT NULL THEN btrim(m_nombre[1]) ELSE NULL END AS paciente_nombre,
    CASE
      WHEN m_phone IS NULL THEN NULL
      ELSE NULLIF(public.normalize_phone(regexp_replace(split_part(m_phone[1], '-', 1), '[^0-9]', '', 'g')), '')
    END AS phone_normalized,
    CASE WHEN m_trat IS NOT NULL THEN btrim(m_trat[1]) ELSE NULL END AS tratamiento_nombre
  FROM (
    SELECT
      id,
      regexp_match(asunto, '^\s*([0-9]+)\.') AS m_id,
      regexp_match(asunto, '\.\s*([^\[]+)') AS m_nombre,
      regexp_match(asunto, '\[([^\]]+)\]') AS m_phone,
      regexp_match(asunto, '\(([^)]*)\)\s*$') AS m_trat
    FROM public.produccion_intermediarios
    WHERE asunto IS NOT NULL AND btrim(asunto) <> ''
  ) x
) m
WHERE t.id = m.id;
