-- =============================================================================
-- 20260512125100_create_extensions_schema.sql
--
-- Ensures the 'extensions' schema exists and moves pg_trgm/unaccent there.
-- This prevents failures in functions that use the extensions. prefix.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;

-- Move extensions to the extensions schema if they are in public
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  ELSE
    CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent') THEN
    ALTER EXTENSION unaccent SET SCHEMA extensions;
  ELSE
    CREATE EXTENSION unaccent WITH SCHEMA extensions;
  END IF;
END $$;
