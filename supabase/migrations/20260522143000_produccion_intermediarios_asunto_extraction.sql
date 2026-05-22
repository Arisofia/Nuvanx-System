-- 20260522143000_produccion_intermediarios_asunto_extraction.sql
-- Advanced extraction of structured fields from Doctoralia "asunto" in
-- public.produccion_intermediarios.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE public.produccion_intermediarios
  ADD COLUMN IF NOT EXISTS paciente_nombre TEXT,
  ADD COLUMN IF NOT EXISTS tratamiento_nombre TEXT,
  ADD COLUMN IF NOT EXISTS doctoralia_id TEXT;

CREATE OR REPLACE FUNCTION public.fn_process_asunto_details()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  raw_phone TEXT;
BEGIN
  IF NEW.asunto IS NULL OR btrim(NEW.asunto) = '' THEN
    NEW.doctoralia_id := NULL;
    NEW.paciente_nombre := NULL;
    NEW.tratamiento_nombre := NULL;
    NEW.phone_normalized := NULL;
    RETURN NEW;
  END IF;

  NEW.doctoralia_id := (regexp_match(NEW.asunto, '^\s*([0-9]+)\.'))[1];
  NEW.paciente_nombre := btrim((regexp_match(NEW.asunto, '\.\s*([^\[]+)'))[1]);

  raw_phone := (regexp_match(NEW.asunto, '\[([^\]]+)\]'))[1];
  IF raw_phone IS NOT NULL THEN
    raw_phone := split_part(raw_phone, '-', 1);
    NEW.phone_normalized := NULLIF(regexp_replace(raw_phone, '[^0-9]', '', 'g'), '');
  ELSE
    NEW.phone_normalized := NULL;
  END IF;

  NEW.tratamiento_nombre := btrim((regexp_match(NEW.asunto, '\((.*)\)\s*$'))[1]);

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

UPDATE public.produccion_intermediarios
SET
  doctoralia_id = (regexp_match(asunto, '^\s*([0-9]+)\.'))[1],
  paciente_nombre = btrim((regexp_match(asunto, '\.\s*([^\[]+)'))[1]),
  phone_normalized = CASE
    WHEN (regexp_match(asunto, '\[([^\]]+)\]'))[1] IS NULL THEN NULL
    ELSE NULLIF(
      regexp_replace(
        split_part((regexp_match(asunto, '\[([^\]]+)\]'))[1], '-', 1),
        '[^0-9]',
        '',
        'g'
      ),
      ''
    )
  END,
  tratamiento_nombre = btrim((regexp_match(asunto, '\((.*)\)\s*$'))[1])
WHERE asunto IS NOT NULL;
