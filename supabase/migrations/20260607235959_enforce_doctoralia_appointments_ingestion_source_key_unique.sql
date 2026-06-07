-- =============================================================================
-- Enforce unique constraint on doctoralia_appointments_ingestion.source_key
-- 
-- CRITICAL FIX: The upsert operation in scripts/populate-doctoralia-appointments.js
-- requires a unique index/constraint on source_key. PostgreSQL error 42P10 indicates
-- the index doesn't exist in production despite being defined in earlier migrations.
--
-- This migration ensures the unique index is applied.
-- =============================================================================

BEGIN;

-- First, verify no duplicate source_key values exist
-- If this query returns rows, we have a data quality issue that must be resolved first
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.doctoralia_appointments_ingestion
    GROUP BY source_key
    HAVING COUNT(*) > 1
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Cannot add unique constraint: duplicate source_key values detected. Run deduplication first.';
  END IF;
END $$;

-- Create the unique index if it doesn't already exist
CREATE UNIQUE INDEX IF NOT EXISTS ux_doctoralia_appointments_ingestion_source_key
  ON public.doctoralia_appointments_ingestion (source_key);

-- Verify the index was created
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE tablename = 'doctoralia_appointments_ingestion'
      AND indexname = 'ux_doctoralia_appointments_ingestion_source_key'
  ) THEN
    RAISE EXCEPTION 'Failed to create unique index on source_key';
  END IF;
  
  RAISE NOTICE 'Unique index ux_doctoralia_appointments_ingestion_source_key successfully created or verified';
END $$;

COMMIT;
