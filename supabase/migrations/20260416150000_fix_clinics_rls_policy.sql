-- Fix: replace overly permissive clinics_service_role (ALL / USING true / WITH CHECK true)
-- with a scoped SELECT-only policy for authenticated users.
-- All writes go through supabaseAdmin (service key), which bypasses RLS.

-- 1) Drop the permissive always-true policy
DROP POLICY IF EXISTS clinics_service_role ON public.clinics;

-- 2) Authenticated users can read only their own clinic
CREATE POLICY clinics_select_own ON public.clinics
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT u.clinic_id
      FROM public.users u
      WHERE u.id = auth.uid()
    )
  );
