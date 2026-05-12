-- =====================================================
-- Fix: Improved Matching + Revenue Traceability
-- ensures phone_normalized columns exist
-- updates converted_patient_id AND verified_revenue
-- =====================================================

-- 0. Ensure columns exist (in case previous migrations failed/skipped)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS phone_normalized TEXT;
ALTER TABLE public.financial_settlements ADD COLUMN IF NOT EXISTS phone_normalized TEXT;
ALTER TABLE public.financial_settlements ADD COLUMN IF NOT EXISTS patient_phone TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'doctoralia_patients'
  ) THEN
    ALTER TABLE public.doctoralia_patients ADD COLUMN IF NOT EXISTS phone_normalized TEXT;
  END IF;
END $$;

-- 1. Reusable Spanish phone normalizer (if missing)
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

-- 2. Backfill normalization
UPDATE public.leads
SET phone_normalized = public.normalize_phone(phone)
WHERE phone IS NOT NULL
  AND phone_normalized IS NULL;

UPDATE public.financial_settlements
SET phone_normalized = public.normalize_phone(patient_phone)
WHERE patient_phone IS NOT NULL
  AND phone_normalized IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'doctoralia_patients'
  ) THEN
    UPDATE public.doctoralia_patients
    SET phone_normalized = public.normalize_phone(COALESCE(phone_primary, phone_secondary))
    WHERE (phone_primary IS NOT NULL OR phone_secondary IS NOT NULL)
      AND phone_normalized IS NULL;
  END IF;
END $$;

-- 3. Redefine the matching function with Revenue Traceability
CREATE OR REPLACE FUNCTION public.match_leads_to_doctoralia_by_phone()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- First pass: Link leads to patients based on phone
  -- We match leads to doctoralia_patients via phone, and we assume patients table 
  -- has a link to doctoralia_patients (or we create it by matching doctoralia_patients to patients)
  
  -- Step 1: Ensure patients are linked to doctoralia_patients if not already
  -- This is often done by doc_patient_id matching DNI
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'doctoralia_patients'
  ) THEN
    EXECUTE $sql$
      UPDATE public.patients p
      SET phone_normalized = dp.phone_normalized
      FROM public.doctoralia_patients dp
      WHERE p.dni = dp.doc_patient_id
        AND p.phone_normalized IS NULL
        AND dp.phone_normalized IS NOT NULL;
    $sql$;
  END IF;

  -- Step 2: Link leads to patients via phone_normalized
  WITH linked_leads AS (
    UPDATE public.leads l
    SET converted_patient_id = p.id,
        updated_at = NOW()
    FROM public.patients p
    WHERE l.phone_normalized IS NOT NULL
      AND l.converted_patient_id IS NULL
      AND p.phone_normalized IS NOT NULL
      AND l.phone_normalized = p.phone_normalized
      AND (l.source IS NULL OR l.source != 'doctoralia')
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM linked_leads;

  -- Step 3: Link settlements to patients
  -- We use the fact that settlement ID starts with or contains doc_patient_id
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'doctoralia_patients'
  ) THEN
    EXECUTE $sql$
      UPDATE public.financial_settlements fs
      SET patient_id = p.id
      FROM public.doctoralia_patients dp
      JOIN public.patients p ON p.dni = dp.doc_patient_id
      WHERE fs.patient_id IS NULL
        AND fs.id LIKE dp.doc_patient_id || '%';
    $sql$;
  END IF;

  -- Second pass: Update verified_revenue for all linked leads
  -- This ensures that even previously linked leads get their revenue updated
  UPDATE public.leads l
  SET verified_revenue = rev.total_revenue,
      updated_at = NOW()
  FROM (
    SELECT 
      fs.patient_id, 
      SUM(fs.amount_net) as total_revenue
    FROM public.financial_settlements fs
    WHERE fs.cancelled_at IS NULL
    GROUP BY fs.patient_id
  ) rev
  WHERE l.converted_patient_id = rev.patient_id
    AND l.verified_revenue != rev.total_revenue;

  RETURN COALESCE(updated_count, 0);
END;
$$;

-- 2. Compatibility wrapper
CREATE OR REPLACE FUNCTION public.match_doctoralia_leads_by_phone()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RETURN public.match_leads_to_doctoralia_by_phone();
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_leads_to_doctoralia_by_phone() TO service_role;
GRANT EXECUTE ON FUNCTION public.match_doctoralia_leads_by_phone() TO service_role;
GRANT EXECUTE ON FUNCTION public.match_leads_to_doctoralia_by_phone() TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_doctoralia_leads_by_phone() TO authenticated;
