-- Enforce deterministic Meta integration ownership at the persistence layer.
-- The resolver is clinic-scoped and ranks meta_ads above meta, but two connected
-- rows for the same clinic + service would otherwise leave owner selection
-- dependent on row ordering when score and updated_at tie.
--
-- Existing duplicates are never deleted or rewritten: fail closed so ownership
-- must be reconciled explicitly before this invariant can be installed.

BEGIN;

DO $meta_connected_integration_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.integrations i
    WHERE i.clinic_id IS NOT NULL
      AND i.status = 'connected'
      AND i.service IN ('meta', 'meta_ads')
    GROUP BY i.clinic_id, i.service
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce canonical Meta integration uniqueness: duplicate connected clinic/service rows exist';
  END IF;
END;
$meta_connected_integration_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS integrations_meta_connected_clinic_service_uidx
  ON public.integrations (clinic_id, service)
  WHERE clinic_id IS NOT NULL
    AND status = 'connected'
    AND service IN ('meta', 'meta_ads');

COMMIT;
