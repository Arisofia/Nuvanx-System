-- Migration 007: Fix playbook_executions schema and reset stale seed data
-- Applied: 2026-04-16

-- ─── Remove duplicate FK constraint on playbook_executions ───────────────────
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'playbook_executions'::regclass
    AND contype = 'f'
    AND conname != 'playbook_executions_playbook_id_fkey'
  ORDER BY oid
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE playbook_executions DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;
END $$;

-- ─── Fix default status value ────────────────────────────────────────────────
ALTER TABLE playbook_executions
  ALTER COLUMN status SET DEFAULT 'triggered';

-- ─── Reset stale demo seed data in dashboard_metrics to real zeros ───────────
UPDATE dashboard_metrics
SET
  total_leads       = 0,
  active_leads      = 0,
  monthly_revenue   = 0,
  conversion_rate   = 0
WHERE
  total_leads = 42        -- demo placeholder value
  OR monthly_revenue = 45200;  -- demo placeholder value
