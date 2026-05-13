-- =============================================================================
-- Create Produccion Intermediarios staging table
--
-- Source: Doctoralia / Google Sheets tab "Produccion Intermediarios".
-- Purpose: preserve the spreadsheet columns A-K, derive a normalized phone from
-- the Asunto field, and keep the table secure-by-default under Supabase RLS.
-- =============================================================================

BEGIN;

-- Create or skip table in a single path: if the table doesn't exist, create it
-- with all columns; if it does exist, ensure columns are added (but do not duplicate
-- the CREATE statement to avoid schema drift).
DO $$
BEGIN
  IF to_regclass('public.produccion_intermediarios') IS NULL THEN
    CREATE TABLE public.produccion_intermediarios (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      -- Spreadsheet columns A-K.
      estado TEXT,
      fecha DATE,
      hora TEXT,
      fecha_creacion DATE,
      hora_creacion TIME,
      asunto TEXT,
      agenda TEXT,
      sala_box TEXT,
      confirmada BOOLEAN DEFAULT FALSE,
      procedencia TEXT,
      importe NUMERIC(12, 2) DEFAULT 0.00,

      -- Derived identity field for deterministic matching against leads/patients.
      phone_normalized TEXT,

      -- Operational metadata.
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  ELSE
    -- Table exists; ensure all columns are added (idempotent, handles evolution).
    ALTER TABLE public.produccion_intermediarios
      ADD COLUMN IF NOT EXISTS estado TEXT,
      ADD COLUMN IF NOT EXISTS fecha DATE,
      ADD COLUMN IF NOT EXISTS hora TEXT,
      ADD COLUMN IF NOT EXISTS fecha_creacion DATE,
      ADD COLUMN IF NOT EXISTS hora_creacion TIME,
      ADD COLUMN IF NOT EXISTS asunto TEXT,
      ADD COLUMN IF NOT EXISTS agenda TEXT,
      ADD COLUMN IF NOT EXISTS sala_box TEXT,
      ADD COLUMN IF NOT EXISTS confirmada BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS procedencia TEXT,
      ADD COLUMN IF NOT EXISTS importe NUMERIC(12, 2) DEFAULT 0.00,
      ADD COLUMN IF NOT EXISTS phone_normalized TEXT,
      ADD COLUMN IF NOT EXISTS inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

COMMENT ON TABLE public.produccion_intermediarios IS
  'Doctoralia Produccion Intermediarios spreadsheet staging table. Preserves columns A-K and normalizes phone from asunto for attribution matching.';

COMMENT ON COLUMN public.produccion_intermediarios.hora IS
  'Appointment time slot preserved as text because source values can be ranges such as 15:00 - 15:20.';

COMMENT ON COLUMN public.produccion_intermediarios.phone_normalized IS
  'First Spanish local phone extracted from the first bracketed token in asunto and normalized through public.normalize_phone(TEXT).';

CREATE INDEX IF NOT EXISTS idx_produccion_intermediarios_fecha
  ON public.produccion_intermediarios (fecha)
  WHERE fecha IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_produccion_intermediarios_estado
  ON public.produccion_intermediarios (estado)
  WHERE estado IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_produccion_intermediarios_agenda
  ON public.produccion_intermediarios (agenda)
  WHERE agenda IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_produccion_intermediarios_procedencia
  ON public.produccion_intermediarios (procedencia)
  WHERE procedencia IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_produccion_intermediarios_phone_normalized
  ON public.produccion_intermediarios (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE OR REPLACE FUNCTION public.extract_produccion_intermediarios_phone(p_asunto TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  bracket_payload TEXT;
  normalized_payload TEXT;
BEGIN
  IF p_asunto IS NULL OR btrim(p_asunto) = '' THEN
    RETURN NULL;
  END IF;

  -- Expected source shape: "... [657174670 - 657174670] ...".
  -- Only the first bracketed token is considered to avoid leaking unrelated
  -- numbers from notes or procedure descriptions.
  bracket_payload := substring(p_asunto FROM '\[([^\]]+)\]');

  IF bracket_payload IS NULL OR btrim(bracket_payload) = '' THEN
    RETURN NULL;
  END IF;

  normalized_payload := public.normalize_phone(bracket_payload);

  IF normalized_payload IS NULL OR normalized_payload = '' THEN
    RETURN NULL;
  END IF;

  -- Doctoralia frequently repeats the same phone inside the brackets. Matching
  -- must keep a single Spanish local phone, not concatenate both copies.
  IF length(normalized_payload) > 9 THEN
    RETURN left(normalized_payload, 9);
  END IF;

  RETURN normalized_payload;
END;
$$;

COMMENT ON FUNCTION public.extract_produccion_intermediarios_phone(TEXT) IS
  'Extracts the first bracketed Doctoralia phone from asunto and returns one normalized Spanish local phone for matching.';

CREATE OR REPLACE FUNCTION public.fn_extract_and_normalize_produccion_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.phone_normalized := public.extract_produccion_intermediarios_phone(NEW.asunto);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_touch_produccion_intermediarios_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_normalize_phone_doctoralia ON public.produccion_intermediarios;
CREATE TRIGGER tr_normalize_phone_doctoralia
  BEFORE INSERT OR UPDATE OF asunto
  ON public.produccion_intermediarios
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_extract_and_normalize_produccion_phone();

DROP TRIGGER IF EXISTS tr_touch_produccion_intermediarios_updated_at ON public.produccion_intermediarios;
CREATE TRIGGER tr_touch_produccion_intermediarios_updated_at
  BEFORE UPDATE
  ON public.produccion_intermediarios
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_touch_produccion_intermediarios_updated_at();

ALTER TABLE public.produccion_intermediarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS produccion_intermediarios_service_role_all ON public.produccion_intermediarios;
CREATE POLICY produccion_intermediarios_service_role_all
  ON public.produccion_intermediarios
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produccion_intermediarios TO service_role;

COMMIT;
