-- =============================================================================
-- Reconciliation hardening: clinic-scoped matching + DNI+Name guard
--
-- Why:
-- - Keep deterministic cascade (dni_hash -> phone -> email)
-- - Add stronger match path when Meta lead carries DNI and name
-- - Avoid cross-clinic collisions by enforcing clinic scope in RPC matching
-- =============================================================================

-- 1) Normalized name columns used for deterministic matching
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS name_normalized TEXT;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS name_normalized TEXT;

-- 2) Normalization helper
CREATE OR REPLACE FUNCTION public.normalize_person_name(raw_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF raw_name IS NULL THEN
    RETURN NULL;
  END IF;

  cleaned := regexp_replace(lower(trim(raw_name)), '\s+', ' ', 'g');
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  RETURN cleaned;
END;
$$;

-- 3) Keep trigger functions updated with name normalization
CREATE OR REPLACE FUNCTION public.leads_normalize_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    NEW.phone_normalized := normalize_phone(NEW.phone);
  END IF;

  IF NEW.email IS NOT NULL THEN
    NEW.email_normalized := normalize_email(NEW.email);
  END IF;

  IF NEW.dni IS NOT NULL THEN
    NEW.dni_hash := encode(sha256(lower(trim(NEW.dni))::bytea), 'hex');
  END IF;

  IF NEW.name IS NOT NULL THEN
    NEW.name_normalized := normalize_person_name(NEW.name);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.patients_normalize_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    NEW.phone_normalized := normalize_phone(NEW.phone);
  END IF;

  IF NEW.email IS NOT NULL THEN
    NEW.email_normalized := normalize_email(NEW.email);
  END IF;

  IF NEW.dni IS NOT NULL THEN
    NEW.dni_hash := encode(sha256(lower(trim(NEW.dni))::bytea), 'hex');
  END IF;

  IF NEW.name IS NOT NULL THEN
    NEW.name_normalized := normalize_person_name(NEW.name);
  END IF;

  RETURN NEW;
END;
$$;

-- 4) Backfill normalized name values
UPDATE public.leads
SET name_normalized = normalize_person_name(name)
WHERE name IS NOT NULL
  AND (name_normalized IS NULL OR name_normalized = '');

UPDATE public.patients
SET name_normalized = normalize_person_name(name)
WHERE name IS NOT NULL
  AND (name_normalized IS NULL OR name_normalized = '');

-- 5) Supporting indexes
CREATE INDEX IF NOT EXISTS leads_name_normalized_idx
  ON public.leads (user_id, name_normalized)
  WHERE name_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS patients_name_normalized_idx
  ON public.patients (clinic_id, name_normalized)
  WHERE name_normalized IS NOT NULL;

-- 6) Hardened reconciliation RPC
-- Cascade:
--   A) DNI hash + normalized name (strongest when both captured)
--   B) DNI hash
--   C) phone_normalized
--   D) email_normalized
-- Always constrained by clinic_id.
CREATE OR REPLACE FUNCTION public.reconcile_lead_to_patient(p_lead_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lead       public.leads%ROWTYPE;
  v_patient_id UUID;
  v_clinic_id  UUID;
BEGIN
  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_lead.converted_patient_id IS NOT NULL THEN
    RETURN v_lead.converted_patient_id;
  END IF;

  SELECT u.clinic_id INTO v_clinic_id
  FROM public.users u
  WHERE u.id = v_lead.user_id
  LIMIT 1;

  IF v_clinic_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Strategy A: DNI hash + normalized name
  IF v_lead.dni_hash IS NOT NULL AND v_lead.name_normalized IS NOT NULL THEN
    SELECT p.id INTO v_patient_id
    FROM public.patients p
    WHERE p.clinic_id = v_clinic_id
      AND p.dni_hash = v_lead.dni_hash
      AND p.name_normalized = v_lead.name_normalized
    LIMIT 1;

    IF v_patient_id IS NOT NULL THEN
      UPDATE public.leads
      SET converted_patient_id = v_patient_id,
          updated_at = NOW()
      WHERE id = p_lead_id;
      RETURN v_patient_id;
    END IF;
  END IF;

  -- Strategy B: DNI hash
  IF v_lead.dni_hash IS NOT NULL THEN
    SELECT p.id INTO v_patient_id
    FROM public.patients p
    WHERE p.clinic_id = v_clinic_id
      AND p.dni_hash = v_lead.dni_hash
    LIMIT 1;

    IF v_patient_id IS NOT NULL THEN
      UPDATE public.leads
      SET converted_patient_id = v_patient_id,
          updated_at = NOW()
      WHERE id = p_lead_id;
      RETURN v_patient_id;
    END IF;
  END IF;

  -- Strategy C: normalized phone
  IF v_lead.phone_normalized IS NOT NULL THEN
    SELECT p.id INTO v_patient_id
    FROM public.patients p
    WHERE p.clinic_id = v_clinic_id
      AND p.phone_normalized = v_lead.phone_normalized
    LIMIT 1;

    IF v_patient_id IS NOT NULL THEN
      UPDATE public.leads
      SET converted_patient_id = v_patient_id,
          updated_at = NOW()
      WHERE id = p_lead_id;
      RETURN v_patient_id;
    END IF;
  END IF;

  -- Strategy D: normalized email
  IF v_lead.email_normalized IS NOT NULL THEN
    SELECT p.id INTO v_patient_id
    FROM public.patients p
    WHERE p.clinic_id = v_clinic_id
      AND p.email_normalized = v_lead.email_normalized
    LIMIT 1;

    IF v_patient_id IS NOT NULL THEN
      UPDATE public.leads
      SET converted_patient_id = v_patient_id,
          updated_at = NOW()
      WHERE id = p_lead_id;
      RETURN v_patient_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;
