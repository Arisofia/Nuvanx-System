-- =============================================================================
-- Supabase Advisor: remaining unindexed foreign keys
--
-- Adds missing leading-column indexes for the FK constraints reported by the
-- database linter. This migration is intentionally additive: unused-index
-- findings are not dropped here because several reported indexes are FK-covering
-- guardrails or low-volume operational indexes whose usage can depend on the
-- production workload and statistics reset window.
-- =============================================================================

DO $$
DECLARE
  fk_target RECORD;
  column_attnum SMALLINT;
  index_name TEXT;
BEGIN
  FOR fk_target IN
    SELECT *
    FROM (VALUES
      ('agent_run_steps', 'run_id'),
      ('agent_runs', 'execution_id'),
      ('agent_runs', 'playbook_id'),
      ('appointments', 'clinic_id'),
      ('appointments', 'doctor_id'),
      ('appointments', 'patient_id'),
      ('appointments', 'treatment_type_id'),
      ('credentials', 'clinic_id'),
      ('doctors', 'clinic_id'),
      ('integrations', 'clinic_id'),
      ('kpi_values', 'kpi_id'),
      ('lead_scores', 'lead_id'),
      ('leads', 'assigned_to'),
      ('leads', 'converted_patient_id'),
      ('leads', 'doctor_id'),
      ('leads', 'treatment_type_id'),
      ('playbook_executions', 'agent_output_id'),
      ('playbooks', 'owner_user_id'),
      ('side_effect_locks', 'playbook_id'),
      ('treatment_types', 'clinic_id'),
      ('users', 'clinic_id')
    ) AS target(table_name, column_name)
  LOOP
    SELECT att.attnum
      INTO column_attnum
    FROM pg_attribute att
    JOIN pg_class tbl ON tbl.oid = att.attrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname = 'public'
      AND tbl.relname = fk_target.table_name
      AND att.attname = fk_target.column_name
      AND NOT att.attisdropped;

    IF column_attnum IS NULL THEN
      RAISE NOTICE 'Skipping %.%: column not found', fk_target.table_name, fk_target.column_name;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_index idx
      JOIN pg_class tbl ON tbl.oid = idx.indrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      WHERE ns.nspname = 'public'
        AND tbl.relname = fk_target.table_name
        AND idx.indisvalid
        AND idx.indpred IS NULL
        AND idx.indkey[0] = column_attnum
    ) THEN
      RAISE NOTICE 'Skipping %.%: covering index already exists', fk_target.table_name, fk_target.column_name;
      CONTINUE;
    END IF;

    index_name := format('adv_fk_%s_%s', fk_target.table_name, fk_target.column_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)',
      index_name,
      fk_target.table_name,
      fk_target.column_name
    );

    EXECUTE format('ANALYZE public.%I', fk_target.table_name);
    RAISE NOTICE 'Created FK covering index % on public.%(%)', index_name, fk_target.table_name, fk_target.column_name;
  END LOOP;
END $$;
