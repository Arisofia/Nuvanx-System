-- =============================================================================
-- Align Doctoralia appointments ingestion runtime schema with production table
-- expectations observed by the daily sync loader.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.doctoralia_appointments_ingestion') IS NULL THEN
    RAISE NOTICE 'Skipping Doctoralia appointments runtime schema alignment: table does not exist yet';
    RETURN;
  END IF;

  ALTER TABLE public.doctoralia_appointments_ingestion
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

  UPDATE public.doctoralia_appointments_ingestion
  SET sheet_row = 0
  WHERE sheet_row IS NULL;

  ALTER TABLE public.doctoralia_appointments_ingestion
    ALTER COLUMN sheet_row SET NOT NULL,
    ALTER COLUMN source_key SET NOT NULL,
    ALTER COLUMN raw_data SET DEFAULT '{}'::JSONB,
    ALTER COLUMN imported_at SET DEFAULT NOW(),
    ALTER COLUMN updated_at SET DEFAULT NOW();
END $$;

COMMENT ON COLUMN public.doctoralia_appointments_ingestion.imported_at IS
  'Timestamp when the appointment ingestion row was first imported. Kept as production-compatible alias for inserted_at.';
