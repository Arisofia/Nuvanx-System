-- =============================================================================
-- Enforce unique constraint on doctoralia_appointments_ingestion.source_key
--
-- The ingestion table is created later in some preview migration replays. Keep
-- this production repair migration order-safe by skipping when the table is not
-- present; the table-creation migration also creates the same unique index.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.doctoralia_appointments_ingestion') IS NULL THEN
    RAISE NOTICE 'Skipping Doctoralia ingestion source_key uniqueness repair: table does not exist yet';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.doctoralia_appointments_ingestion
    GROUP BY source_key
    HAVING COUNT(*) > 1
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Cannot add unique constraint: duplicate source_key values detected. Run deduplication first.';
  END IF;

  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS ux_doctoralia_appointments_ingestion_source_key ON public.doctoralia_appointments_ingestion (source_key)';

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'doctoralia_appointments_ingestion'
      AND indexname = 'ux_doctoralia_appointments_ingestion_source_key'
  ) THEN
    RAISE EXCEPTION 'Failed to create unique index on source_key';
  END IF;

  RAISE NOTICE 'Unique index ux_doctoralia_appointments_ingestion_source_key successfully created or verified';
END $$;

COMMIT;
