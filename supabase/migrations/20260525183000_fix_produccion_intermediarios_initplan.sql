BEGIN;

-- Resolve auth_rls_initplan warning by forcing auth/current_setting evaluation through
-- initplan-friendly scalar subqueries.
DROP POLICY IF EXISTS produccion_intermediarios_select ON public.produccion_intermediarios;
CREATE POLICY produccion_intermediarios_select ON public.produccion_intermediarios
  FOR SELECT TO authenticated
  USING (
    (
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.is_anonymous', true), ''), 'false')
    ) <> 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

COMMIT;
