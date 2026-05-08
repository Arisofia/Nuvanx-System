-- =====================================================
-- Manual backfill: Doctoralia phone-only lead matching
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/match-leads-doctoralia-by-phone.sql
--   -- or paste into the Supabase SQL editor as service role.
--
-- Business rule:
--   A non-Doctoralia acquisition lead is converted to a Doctoralia patient only
--   when normalize_phone(leads.phone) equals normalize_phone(financial_settlements.patient_phone).
--   DNI / dni_hash are intentionally not used anywhere in this pipeline.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF p_phone IS NULL OR btrim(p_phone) = '' THEN
    RETURN NULL;
  END IF;

  cleaned := regexp_replace(p_phone, '[^0-9]', '', 'g');

  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  IF cleaned LIKE '0034%' THEN
    cleaned := substring(cleaned FROM 5);
  ELSIF length(cleaned) > 9 AND cleaned LIKE '34%' THEN
    cleaned := substring(cleaned FROM 3);
  END IF;

  cleaned := regexp_replace(cleaned, '[^0-9]', '', 'g');

  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  RETURN cleaned;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_phone_for_matching(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN public.normalize_phone(p_phone);
END;
$$;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

ALTER TABLE public.financial_settlements
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

UPDATE public.leads
SET phone_normalized = public.normalize_phone(phone)
WHERE phone IS NOT NULL
  AND public.normalize_phone(phone) IS NOT NULL
  AND phone_normalized IS DISTINCT FROM public.normalize_phone(phone);

UPDATE public.financial_settlements
SET phone_normalized = public.normalize_phone(patient_phone)
WHERE source_system = 'doctoralia'
  AND patient_phone IS NOT NULL
  AND public.normalize_phone(patient_phone) IS NOT NULL
  AND phone_normalized IS DISTINCT FROM public.normalize_phone(patient_phone);

CREATE INDEX IF NOT EXISTS idx_leads_phone_normalized
  ON public.leads (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_clinic_phone_normalized
  ON public.leads (clinic_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_financial_settlements_phone_normalized
  ON public.financial_settlements (phone_normalized)
  WHERE phone_normalized IS NOT NULL
    AND source_system = 'doctoralia';

CREATE INDEX IF NOT EXISTS idx_financial_settlements_clinic_phone_normalized
  ON public.financial_settlements (clinic_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL
    AND source_system = 'doctoralia';

CREATE OR REPLACE FUNCTION public.match_leads_to_doctoralia_by_phone()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  WITH updated_leads AS (
    UPDATE public.leads l
    SET converted_patient_id = fs.patient_id,
        updated_at = NOW()
    FROM public.financial_settlements fs
    WHERE l.phone_normalized IS NOT NULL
      AND l.converted_patient_id IS NULL
      AND fs.phone_normalized IS NOT NULL
      AND fs.source_system = 'doctoralia'
      AND fs.patient_id IS NOT NULL
      AND l.phone_normalized = fs.phone_normalized
      AND (l.source IS NULL OR l.source != 'doctoralia')
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated_leads;

  RETURN COALESCE(updated_count, 0);
END;
$$;

COMMENT ON FUNCTION public.match_leads_to_doctoralia_by_phone() IS
  'Batch matching pipeline: updates converted_patient_id on acquisition leads when phone_normalized matches normalized patient_phone in financial_settlements (source_system=doctoralia). Idempotent and safe.';

SELECT public.match_leads_to_doctoralia_by_phone();

COMMIT;
