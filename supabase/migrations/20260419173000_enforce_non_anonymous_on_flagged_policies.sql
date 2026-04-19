-- Supabase advisor lint 0012 hardening
-- Update flagged policies to explicitly deny anonymous sign-in sessions

DO $$
DECLARE
  pol RECORD;
  anon_guard CONSTANT TEXT := 'COALESCE((((SELECT auth.jwt()) ->> ''is_anonymous''))::boolean, false) = false';
  using_expr TEXT;
  check_expr TEXT;
BEGIN
  FOR pol IN
    SELECT p.schemaname, p.tablename, p.policyname, p.cmd, p.qual, p.with_check
    FROM pg_policies p
    JOIN (
      VALUES
        ('auth', 'users', 'users_select_own'),
        ('auth', 'users', 'users_update_own'),
        ('monitoring', 'commands', 'authenticated_read_commands'),
        ('monitoring', 'operational_events', 'authenticated_read_events'),
        ('public', 'agent_outputs', 'agent_outputs_select_own'),
        ('public', 'appointments', 'appointments_select_clinic'),
        ('public', 'clinics', 'clinics_delete_own'),
        ('public', 'clinics', 'clinics_select_own'),
        ('public', 'clinics', 'clinics_update_own'),
        ('public', 'credentials', 'credentials_delete_own'),
        ('public', 'credentials', 'credentials_update_own'),
        ('public', 'dashboard_metrics', 'dashboard_metrics_auth_read'),
        ('public', 'design_tokens', 'design_tokens_auth_read'),
        ('public', 'doctors', 'doctors_select_clinic'),
        ('public', 'financial_settlements', 'settlements_select_clinic'),
        ('public', 'integrations', 'integrations_delete_own'),
        ('public', 'integrations', 'integrations_select_own'),
        ('public', 'integrations', 'integrations_update_own'),
        ('public', 'kpi_blocked', 'kpi_blocked_select_authenticated'),
        ('public', 'kpi_definitions', 'kpi_definitions_read_all'),
        ('public', 'kpi_values', 'kpi_values_owner_only'),
        ('public', 'patients', 'patients_select_clinic'),
        ('public', 'playbook_executions', 'playbook_executions_user'),
        ('public', 'treatment_types', 'treatment_types_select_clinic'),
        ('public', 'users', 'users_select_own'),
        ('public', 'users', 'users_update_own'),
        ('public', 'whatsapp_conversations', 'wa_conv_clinic_select')
    ) AS target(schema_name, table_name, policy_name)
      ON p.schemaname = target.schema_name
     AND p.tablename = target.table_name
     AND p.policyname = target.policy_name
  LOOP
    -- Force policy role scope to authenticated only.
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I TO authenticated;',
      pol.policyname,
      pol.schemaname,
      pol.tablename
    );

    IF pol.cmd IN ('SELECT', 'UPDATE', 'DELETE', 'ALL') THEN
      using_expr := CASE
        WHEN pol.qual IS NULL OR btrim(pol.qual) = '' THEN anon_guard
        WHEN position('is_anonymous' IN pol.qual) > 0 THEN pol.qual
        ELSE format('(%s) AND (%s)', pol.qual, anon_guard)
      END;

      EXECUTE format(
        'ALTER POLICY %I ON %I.%I USING (%s);',
        pol.policyname,
        pol.schemaname,
        pol.tablename,
        using_expr
      );
    END IF;

    IF pol.cmd IN ('INSERT', 'UPDATE', 'ALL') THEN
      check_expr := CASE
        WHEN pol.with_check IS NULL OR btrim(pol.with_check) = '' THEN anon_guard
        WHEN position('is_anonymous' IN pol.with_check) > 0 THEN pol.with_check
        ELSE format('(%s) AND (%s)', pol.with_check, anon_guard)
      END;

      EXECUTE format(
        'ALTER POLICY %I ON %I.%I WITH CHECK (%s);',
        pol.policyname,
        pol.schemaname,
        pol.tablename,
        check_expr
      );
    END IF;
  END LOOP;
END $$;
