-- =============================================================================
-- Specific RLS policies for financial_settlements and leads
-- Optimized with (SELECT ...) subqueries for performance (auth_rls_initplan)
-- =============================================================================

-- 1. financial_settlements_select_clinic
DROP POLICY IF EXISTS financial_settlements_select_clinic ON public.financial_settlements;
CREATE POLICY financial_settlements_select_clinic ON public.financial_settlements
  FOR SELECT TO authenticated
  USING (
    ((SELECT auth.jwt()) ->> 'is_anonymous') IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- 2. leads_select_authenticated
DROP POLICY IF EXISTS leads_select_authenticated ON public.leads;
CREATE POLICY leads_select_authenticated ON public.leads
  FOR SELECT TO authenticated
  USING (
    ((SELECT auth.jwt()) ->> 'is_anonymous') IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

COMMENT ON POLICY financial_settlements_select_clinic ON public.financial_settlements IS 'Optimized clinic-scoped SELECT for financial_settlements.';
COMMENT ON POLICY leads_select_authenticated ON public.leads IS 'Optimized clinic-scoped SELECT for leads.';
