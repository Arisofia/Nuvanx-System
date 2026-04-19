-- Supabase advisor security hardening
-- 1) Block anonymous sign-ins from authenticated-role policies via restrictive guards
-- 2) Add explicit policies for RLS-enabled tables that currently have none

DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT *
    FROM (
      VALUES
        ('auth', 'users'),
        ('monitoring', 'commands'),
        ('monitoring', 'operational_events'),
        ('public', 'agent_outputs'),
        ('public', 'appointments'),
        ('public', 'clinics'),
        ('public', 'credentials'),
        ('public', 'dashboard_metrics'),
        ('public', 'design_tokens'),
        ('public', 'doctors'),
        ('public', 'financial_settlements'),
        ('public', 'integrations'),
        ('public', 'kpi_blocked'),
        ('public', 'kpi_definitions'),
        ('public', 'kpi_values'),
        ('public', 'patients'),
        ('public', 'playbook_executions'),
        ('public', 'treatment_types'),
        ('public', 'users'),
        ('public', 'whatsapp_conversations')
    ) AS t(schema_name, table_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = tbl.schema_name
        AND tablename = tbl.table_name
        AND policyname = 'deny_anonymous_authenticated'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (COALESCE((auth.jwt()->>''is_anonymous'')::boolean, false) = false) WITH CHECK (COALESCE((auth.jwt()->>''is_anonymous'')::boolean, false) = false);',
        'deny_anonymous_authenticated',
        tbl.schema_name,
        tbl.table_name
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log'
      AND policyname = 'audit_log_deny_all_authenticated'
  ) THEN
    CREATE POLICY audit_log_deny_all_authenticated
      ON public.audit_log
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'leads'
      AND policyname = 'leads_deny_all_authenticated'
  ) THEN
    CREATE POLICY leads_deny_all_authenticated
      ON public.leads
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;
