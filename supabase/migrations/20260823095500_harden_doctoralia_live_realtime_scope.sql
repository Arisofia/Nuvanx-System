-- The LIVE frontend reads doctoralia_raw directly for the recent-event stream.
-- Keep that browser read authenticated and tenant-scoped while the API continues
-- to use service_role for the agenda projection.

BEGIN;

ALTER TABLE public.doctoralia_raw ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.doctoralia_raw FROM anon;
GRANT SELECT ON TABLE public.doctoralia_raw TO authenticated;

DROP POLICY IF EXISTS doctoralia_raw_select_clinic ON public.doctoralia_raw;
CREATE POLICY doctoralia_raw_select_clinic
ON public.doctoralia_raw
FOR SELECT
TO authenticated
USING (
  COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
  AND clinic_id = (SELECT public.current_clinic_id())
);

DROP POLICY IF EXISTS doctoralia_raw_service_role ON public.doctoralia_raw;
CREATE POLICY doctoralia_raw_service_role
ON public.doctoralia_raw
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMIT;
