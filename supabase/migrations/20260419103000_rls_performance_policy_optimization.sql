-- =============================================================================
-- RLS performance optimization (Supabase linter WARN fixes)
-- - auth_rls_initplan: wrap auth/current_setting calls with SELECT
-- - multiple_permissive_policies: remove overlapping public+service policies
-- - duplicate_index: drop redundant settled_at index
-- =============================================================================

-- ---------------------------------------------------------------------------
-- agent_outputs
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.agent_outputs') IS NOT NULL THEN
    DROP POLICY IF EXISTS agent_outputs_insert_own ON public.agent_outputs;
    CREATE POLICY agent_outputs_insert_own
      ON public.agent_outputs
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS agent_outputs_select_own ON public.agent_outputs;
    CREATE POLICY agent_outputs_select_own
      ON public.agent_outputs
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS agent_outputs_service_all ON public.agent_outputs;
    CREATE POLICY agent_outputs_service_all
      ON public.agent_outputs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- integrations
-- ---------------------------------------------------------------------------
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integrations_insert_own ON public.integrations;
CREATE POLICY integrations_insert_own
  ON public.integrations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integrations_update_own ON public.integrations;
CREATE POLICY integrations_update_own
  ON public.integrations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integrations_delete_own ON public.integrations;
CREATE POLICY integrations_delete_own
  ON public.integrations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integrations_service_all ON public.integrations;
CREATE POLICY integrations_service_all
  ON public.integrations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- credentials
-- ---------------------------------------------------------------------------
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credentials_delete_own ON public.credentials;
CREATE POLICY credentials_delete_own
  ON public.credentials
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credentials_update_own ON public.credentials;
CREATE POLICY credentials_update_own
  ON public.credentials
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credentials_service_role_only ON public.credentials;
CREATE POLICY credentials_service_role_only
  ON public.credentials
  AS RESTRICTIVE
  FOR ALL
  TO public
  USING (((SELECT current_setting('role'::text, true)) = 'service_role'::text) OR (auth.uid() = user_id));

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_owner_only ON public.leads;
CREATE POLICY leads_owner_only
  ON public.leads
  FOR ALL
  TO public
  USING (((SELECT current_setting('role'::text, true)) = 'service_role'::text) OR (auth.uid() = user_id))
  WITH CHECK (((SELECT current_setting('role'::text, true)) = 'service_role'::text) OR (auth.uid() = user_id));

-- ---------------------------------------------------------------------------
-- dashboard_metrics
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS dashboard_metrics_auth_read ON public.dashboard_metrics;
CREATE POLICY dashboard_metrics_auth_read
  ON public.dashboard_metrics
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS dashboard_metrics_service_rw ON public.dashboard_metrics;
CREATE POLICY dashboard_metrics_service_rw
  ON public.dashboard_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- design_tokens
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.design_tokens') IS NOT NULL THEN
    DROP POLICY IF EXISTS design_tokens_auth_read ON public.design_tokens;
    CREATE POLICY design_tokens_auth_read
      ON public.design_tokens
      FOR SELECT
      TO authenticated
      USING (true);

    DROP POLICY IF EXISTS design_tokens_service_role ON public.design_tokens;
    CREATE POLICY design_tokens_service_role
      ON public.design_tokens
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- playbook_executions
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS playbook_executions_user ON public.playbook_executions;
CREATE POLICY playbook_executions_user
  ON public.playbook_executions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- clinic-scoped SELECT policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS patients_select_clinic ON public.patients;
CREATE POLICY patients_select_clinic
  ON public.patients
  FOR SELECT
  TO authenticated
  USING (clinic_id = (((SELECT auth.jwt()) ->> 'clinic_id'::text))::uuid);

DROP POLICY IF EXISTS doctors_select_clinic ON public.doctors;
CREATE POLICY doctors_select_clinic
  ON public.doctors
  FOR SELECT
  TO authenticated
  USING (clinic_id = (((SELECT auth.jwt()) ->> 'clinic_id'::text))::uuid);

DROP POLICY IF EXISTS treatment_types_select_clinic ON public.treatment_types;
CREATE POLICY treatment_types_select_clinic
  ON public.treatment_types
  FOR SELECT
  TO authenticated
  USING (clinic_id = (((SELECT auth.jwt()) ->> 'clinic_id'::text))::uuid);

DROP POLICY IF EXISTS appointments_select_clinic ON public.appointments;
CREATE POLICY appointments_select_clinic
  ON public.appointments
  FOR SELECT
  TO authenticated
  USING (clinic_id = (((SELECT auth.jwt()) ->> 'clinic_id'::text))::uuid);

DROP POLICY IF EXISTS settlements_select_clinic ON public.financial_settlements;
CREATE POLICY settlements_select_clinic
  ON public.financial_settlements
  FOR SELECT
  TO authenticated
  USING (clinic_id = (((SELECT auth.jwt()) ->> 'clinic_id'::text))::uuid);

DROP POLICY IF EXISTS wa_conv_clinic_select ON public.whatsapp_conversations;
CREATE POLICY wa_conv_clinic_select
  ON public.whatsapp_conversations
  FOR SELECT
  TO authenticated
  USING (clinic_id = (((SELECT auth.jwt()) ->> 'clinic_id'::text))::uuid);

-- ---------------------------------------------------------------------------
-- clinics
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS clinics_select_own ON public.clinics;
CREATE POLICY clinics_select_own
  ON public.clinics
  FOR SELECT
  TO authenticated
  USING (id IN (SELECT u.clinic_id FROM users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS clinics_update_own ON public.clinics;
CREATE POLICY clinics_update_own
  ON public.clinics
  FOR UPDATE
  TO authenticated
  USING (id IN (SELECT u.clinic_id FROM users u WHERE u.id = (SELECT auth.uid())))
  WITH CHECK (id IN (SELECT u.clinic_id FROM users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS clinics_insert_own ON public.clinics;
CREATE POLICY clinics_insert_own
  ON public.clinics
  FOR INSERT
  TO authenticated
  WITH CHECK (id IN (SELECT u.clinic_id FROM users u WHERE u.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS clinics_delete_own ON public.clinics;
CREATE POLICY clinics_delete_own
  ON public.clinics
  FOR DELETE
  TO authenticated
  USING (id IN (SELECT u.clinic_id FROM users u WHERE u.id = (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- duplicate index (keep settlements_clinic_settled_idx)
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.settlements_clinic_date_idx;


