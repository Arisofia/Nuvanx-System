-- Apply Supabase AI advisor finding: unindexed_foreign_keys
-- Ensures all listed single-column foreign keys have a covering btree index

DO $$
DECLARE
  fk RECORD;
  target_fks TEXT[] := ARRAY[
    'public.agent_outputs.agent_outputs_clinic_id_fkey',
    'public.agent_run_steps.agent_run_steps_run_id_fkey',
    'public.agent_runs.agent_runs_execution_id_fkey',
    'public.agent_runs.agent_runs_playbook_id_fkey',
    'public.appointments.appointments_clinic_id_fkey',
    'public.appointments.appointments_doctor_id_fkey',
    'public.appointments.appointments_patient_id_fkey',
    'public.appointments.appointments_treatment_type_id_fkey',
    'public.doctors.doctors_clinic_id_fkey',
    'public.financial_settlements.financial_settlements_patient_id_fkey',
    'public.kpi_values.kpi_values_kpi_id_fkey',
    'public.lead_scores.lead_scores_lead_id_fkey',
    'public.lead_timeline_events.lead_timeline_events_lead_id_fkey',
    'public.leads.leads_assigned_to_fkey',
    'public.leads.leads_converted_patient_id_fkey',
    'public.leads.leads_doctor_id_fkey',
    'public.leads.leads_treatment_type_id_fkey',
    'public.side_effect_locks.side_effect_locks_playbook_id_fkey',
    'public.treatment_types.treatment_types_clinic_id_fkey',
    'public.users.users_clinic_id_fkey',
    'public.whatsapp_conversations.whatsapp_conversations_clinic_id_fkey',
    'public.whatsapp_conversations.whatsapp_conversations_lead_id_fkey'
  ];
  idx_name TEXT;
BEGIN
  FOR fk IN
    SELECT
      ns.nspname AS schema_name,
      tbl.relname AS table_name,
      con.conname AS constraint_name,
      att.attname AS column_name,
      con.conrelid,
      con.conkey[1] AS fk_attnum
    FROM pg_constraint con
    JOIN pg_class tbl ON tbl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid
                         AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND array_length(con.conkey, 1) = 1
      AND format('%I.%I.%I', ns.nspname, tbl.relname, con.conname) = ANY(target_fks)
    ORDER BY ns.nspname, tbl.relname, con.conname
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = fk.conrelid
        AND i.indisvalid
        AND i.indpred IS NULL
        AND i.indkey[0] = fk.fk_attnum
    ) THEN
      idx_name := format('%s_%s_fk_idx', fk.table_name, fk.column_name);

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%I);',
        idx_name,
        fk.schema_name,
        fk.table_name,
        fk.column_name
      );

      RAISE NOTICE 'Created missing FK index %.% (%)', fk.schema_name, fk.table_name, fk.column_name;
    END IF;
  END LOOP;
END $$;

ANALYZE public.agent_outputs;
ANALYZE public.agent_run_steps;
ANALYZE public.agent_runs;
ANALYZE public.appointments;
ANALYZE public.doctors;
ANALYZE public.financial_settlements;
ANALYZE public.kpi_values;
ANALYZE public.lead_scores;
ANALYZE public.lead_timeline_events;
ANALYZE public.leads;
ANALYZE public.playbooks;
ANALYZE public.side_effect_locks;
ANALYZE public.treatment_types;
ANALYZE public.users;
ANALYZE public.whatsapp_conversations;
