-- =====================================================
-- Migration: Phone normalization + Doctoralia phone matching
-- Date: 2026-05-10
-- Project: Nuvanx
--
-- Business rule:
--   Leads are matched to Doctoralia patients exclusively by normalized phone.
--   DNI / dni_hash are intentionally not used anywhere in this pipeline.
-- =====================================================

BEGIN;

-- 1. Reusable Spanish phone normalizer.
--    Output format: local digits only, e.g. +34 612 345 678 -> 612345678.
CREATE OR REPLACE FUNCTION public.normalize_phone(raw_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF raw_phone IS NULL OR btrim(raw_phone) = '' THEN
    RETURN NULL;
  END IF;

  cleaned := regexp_replace(raw_phone, '[^0-9]', '', 'g');

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

COMMENT ON FUNCTION public.normalize_phone(TEXT) IS
  'Normalizes Spanish phones for matching: strips non-digits and Spanish prefixes (0034, 34). Returns local digits only, e.g. 612345678.';

-- Compatibility alias for scripts or prior review branches that referenced this name.
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

COMMENT ON FUNCTION public.normalize_phone_for_matching(TEXT) IS
  'Compatibility wrapper around public.normalize_phone(TEXT). Matching remains phone-only.';

-- 2. Normalized phone columns.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

ALTER TABLE public.financial_settlements
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'doctoralia_patients'
  ) THEN
    EXECUTE 'ALTER TABLE public.doctoralia_patients ADD COLUMN IF NOT EXISTS phone_normalized TEXT';
  END IF;
END $$;

-- 3. Historical normalization backfill.
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'doctoralia_patients'
  ) THEN
    EXECUTE $cmd$
      UPDATE public.doctoralia_patients
      SET phone_normalized = public.normalize_phone(COALESCE(phone_primary, phone_secondary))
      WHERE COALESCE(phone_primary, phone_secondary) IS NOT NULL
        AND public.normalize_phone(COALESCE(phone_primary, phone_secondary)) IS NOT NULL
        AND phone_normalized IS DISTINCT FROM public.normalize_phone(COALESCE(phone_primary, phone_secondary))
    $cmd$;
  END IF;
END $$;

-- 4. Fast matching indexes.
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'doctoralia_patients'
  ) THEN
    EXECUTE $cmd$
      CREATE INDEX IF NOT EXISTS idx_doctoralia_patients_phone_normalized
      ON public.doctoralia_patients (phone_normalized)
      WHERE phone_normalized IS NOT NULL
    $cmd$;
  END IF;
END $$;

-- 5. Keep normalized phone values current. These triggers normalize only phones;
--    they do not perform matching and do not introduce DNI-based logic.
CREATE OR REPLACE FUNCTION public.trg_normalize_lead_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.phone_normalized := public.normalize_phone(NEW.phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_normalize_phone ON public.leads;
CREATE TRIGGER trg_leads_normalize_phone
  BEFORE INSERT OR UPDATE OF phone ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_normalize_lead_phone();

CREATE OR REPLACE FUNCTION public.trg_normalize_settlement_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.source_system = 'doctoralia' THEN
    NEW.phone_normalized := public.normalize_phone(NEW.patient_phone);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_financial_settlements_normalize_phone ON public.financial_settlements;
CREATE TRIGGER trg_financial_settlements_normalize_phone
  BEFORE INSERT OR UPDATE OF patient_phone, source_system ON public.financial_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_normalize_settlement_phone();

-- 6. Batch phone-only matching. Safe and idempotent: it only fills
--    converted_patient_id when it is currently NULL. Matching is exclusively
--    by phone_normalized; no DNI/hash/name fields are used.
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

-- Backwards-compatible wrapper for the previous function name used during review.
CREATE OR REPLACE FUNCTION public.match_doctoralia_leads_by_phone()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RETURN public.match_leads_to_doctoralia_by_phone();
END;
$$;

COMMENT ON FUNCTION public.match_doctoralia_leads_by_phone() IS
  'Compatibility wrapper around public.match_leads_to_doctoralia_by_phone().';

GRANT EXECUTE ON FUNCTION public.match_leads_to_doctoralia_by_phone() TO service_role;
GRANT EXECUTE ON FUNCTION public.match_doctoralia_leads_by_phone() TO service_role;

-- Historical backfill. Future executions can be manual, cron, or an Edge Function.
SELECT public.match_leads_to_doctoralia_by_phone();

COMMIT;
