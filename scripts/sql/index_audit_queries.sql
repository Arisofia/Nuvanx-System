-- Index audit helper queries (manual forensic validation)
-- Run in Supabase SQL editor or psql before any DROP INDEX decision.

-- 1) FK columns that still do not have a leading-column index.
WITH fk_cols AS (
  SELECT
    ns.nspname AS schema_name,
    c.relname AS table_name,
    con.conname AS fk_name,
    con.conrelid,
    con.conkey[1] AS attnum,
    a.attname AS column_name
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
  WHERE con.contype = 'f'
    AND ns.nspname IN ('public', 'monitoring')
    AND array_length(con.conkey, 1) = 1
)
SELECT fk.*
FROM fk_cols fk
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_index i
  WHERE i.indrelid = fk.conrelid
    AND i.indisvalid
    AND i.indpred IS NULL
    AND i.indkey[0] = fk.attnum
)
ORDER BY fk.schema_name, fk.table_name, fk.column_name;

-- 2) candidate unused indexes in public/monitoring (stats-window dependent).
SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname IN ('public', 'monitoring')
ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;

-- 3) explicit check for lead_scores time-based read pattern.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, lead_id, user_id, score, method, created_at
FROM public.lead_scores
WHERE user_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND created_at >= NOW() - INTERVAL '30 days'
ORDER BY created_at DESC
LIMIT 100;
