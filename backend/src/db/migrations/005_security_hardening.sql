-- =============================================================================
-- Migration 005: Security hardening — RLS policies, stale data reset, FK cleanup
-- =============================================================================
-- Mirror of supabase/migrations/20260416120000_security_hardening.sql
-- See that file for full commentary.
-- =============================================================================

-- ─── 1. credentials ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS credentials_service_role ON public.credentials;
CREATE POLICY credentials_service_role ON public.credentials
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS credentials_owner_only ON public.credentials;
CREATE POLICY credentials_owner_only ON public.credentials
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS credentials_no_authenticated_write ON public.credentials;
CREATE POLICY credentials_no_authenticated_write ON public.credentials
  FOR INSERT TO authenticated
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS credentials_no_authenticated_update ON public.credentials;
CREATE POLICY credentials_no_authenticated_update ON public.credentials
  FOR UPDATE TO authenticated
  USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS credentials_no_authenticated_delete ON public.credentials;
CREATE POLICY credentials_no_authenticated_delete ON public.credentials
  FOR DELETE TO authenticated
  USING (FALSE);

DROP POLICY IF EXISTS credentials_anon_deny ON public.credentials;
CREATE POLICY credentials_anon_deny ON public.credentials
  FOR ALL TO anon USING (FALSE) WITH CHECK (FALSE);


-- ─── 2. leads ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS leads_service_role ON public.leads;
CREATE POLICY leads_service_role ON public.leads
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS leads_owner_only ON public.leads;
CREATE POLICY leads_owner_only ON public.leads
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS leads_no_authenticated_write ON public.leads;
CREATE POLICY leads_no_authenticated_write ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS leads_no_authenticated_update ON public.leads;
CREATE POLICY leads_no_authenticated_update ON public.leads
  FOR UPDATE TO authenticated
  USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS leads_no_authenticated_delete ON public.leads;
CREATE POLICY leads_no_authenticated_delete ON public.leads
  FOR DELETE TO authenticated
  USING (FALSE);

DROP POLICY IF EXISTS leads_anon_deny ON public.leads;
CREATE POLICY leads_anon_deny ON public.leads
  FOR ALL TO anon USING (FALSE) WITH CHECK (FALSE);


-- ─── 3. integrations ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS integrations_service_role ON public.integrations;
CREATE POLICY integrations_service_role ON public.integrations
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS integrations_no_authenticated_write ON public.integrations;
CREATE POLICY integrations_no_authenticated_write ON public.integrations
  FOR INSERT TO authenticated
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS integrations_no_authenticated_update ON public.integrations;
CREATE POLICY integrations_no_authenticated_update ON public.integrations
  FOR UPDATE TO authenticated
  USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS integrations_no_authenticated_delete ON public.integrations;
CREATE POLICY integrations_no_authenticated_delete ON public.integrations
  FOR DELETE TO authenticated
  USING (FALSE);

DROP POLICY IF EXISTS integrations_anon_deny ON public.integrations;
CREATE POLICY integrations_anon_deny ON public.integrations
  FOR ALL TO anon USING (FALSE) WITH CHECK (FALSE);


-- ─── 4. playbook_executions: drop duplicate FK ────────────────────────────
ALTER TABLE public.playbook_executions
  DROP CONSTRAINT IF EXISTS pe_playbook_fk;


-- ─── 5. dashboard_metrics: reset stale seed row ───────────────────────────
UPDATE public.dashboard_metrics SET
  total_leads            = 0,
  total_revenue          = 0,
  connected_integrations = 0,
  total_integrations     = 0,
  leads_lead             = 0,
  leads_whatsapp         = 0,
  leads_appointment      = 0,
  leads_treatment        = 0,
  leads_closed           = 0,
  hubspot_status         = 'disconnected',
  meta_status            = 'disconnected',
  whatsapp_status        = 'disconnected',
  github_status          = 'disconnected',
  openai_status          = 'disconnected',
  gemini_status          = 'disconnected',
  last_sync              = NULL,
  updated_at             = NOW()
WHERE id = 'nuvanx-main';


-- ─── 6. kpi_definitions / kpi_values: service_role policies ───────────────
DROP POLICY IF EXISTS kpi_definitions_service_role ON public.kpi_definitions;
CREATE POLICY kpi_definitions_service_role ON public.kpi_definitions
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS kpi_values_service_role ON public.kpi_values;
CREATE POLICY kpi_values_service_role ON public.kpi_values
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);


-- ─── 7. audit_log: add service_role write policy ─────────────────────────
DROP POLICY IF EXISTS audit_log_service_role ON public.audit_log;
CREATE POLICY audit_log_service_role ON public.audit_log
  FOR INSERT TO service_role WITH CHECK (TRUE);
