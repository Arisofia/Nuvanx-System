-- Final Security Hardening - 23 May 2026

-- 1) financial_settlements
ALTER TABLE IF EXISTS public.financial_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_settlements_service_role_only ON public.financial_settlements;
CREATE POLICY financial_settlements_service_role_only
  ON public.financial_settlements
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 2) agent_outputs
ALTER TABLE IF EXISTS public.agent_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_outputs_read_service ON public.agent_outputs;
CREATE POLICY agent_outputs_read_service
  ON public.agent_outputs
  FOR SELECT
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS agent_outputs_insert_service ON public.agent_outputs;
CREATE POLICY agent_outputs_insert_service
  ON public.agent_outputs
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- 3) Reinforce leads and doctoralia_patients
ALTER TABLE IF EXISTS public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.doctoralia_patients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_public_read ON public.leads;
DROP POLICY IF EXISTS leads_service_only ON public.leads;
CREATE POLICY leads_service_only
  ON public.leads
  USING (auth.role() = 'service_role');

-- 4) Helper function
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN auth.role() = 'service_role';
END;
$$;
