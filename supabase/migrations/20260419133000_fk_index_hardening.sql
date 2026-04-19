-- =============================================================================
-- FK index hardening after linter findings
--
-- Goals:
-- 1) Add missing indexes for single-column foreign keys in public/monitoring.
-- 2) Keep lead_scores_created_at_idx in place until workload evidence supports change.
-- 3) Avoid blind index drops; only additive hardening in this migration.
--
-- Note: We intentionally use CREATE INDEX (not CONCURRENTLY) because Supabase
-- migrations run transactionally. For very large tables, schedule a manual
-- CONCURRENTLY operation during low-traffic windows.
-- =============================================================================

DO $$
DECLARE
  fk RECORD;
  idx_name TEXT;
BEGIN
  FOR fk IN
    SELECT
      ns.nspname AS schema_name,
      tbl.relname AS table_name,
      con.conname AS constraint_name,
      att.attname AS column_name,
      con.conrelid
    FROM pg_constraint con
    JOIN pg_class tbl ON tbl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND ns.nspname IN ('public', 'monitoring')
      AND array_length(con.conkey, 1) = 1
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = con.conrelid
          AND i.indisvalid
          AND i.indpred IS NULL
          -- Covering check: index leading column matches FK column
          AND i.indkey[0] = con.conkey[1]
      )
    ORDER BY ns.nspname, tbl.relname, att.attname
  LOOP
    idx_name := format('%s_%s_fk_idx', fk.table_name, fk.column_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%I);',
      idx_name,
      fk.schema_name,
      fk.table_name,
      fk.column_name
    );

    RAISE NOTICE 'Created missing FK index %.% (%)', fk.schema_name, fk.table_name, fk.column_name;
  END LOOP;
END $$;

-- Guardrail: preserve lead_scores_created_at_idx unless we have proven workload
-- evidence that it is unnecessary for time-based reads/pagination.
CREATE INDEX IF NOT EXISTS lead_scores_created_at_idx
  ON public.lead_scores(created_at DESC);
