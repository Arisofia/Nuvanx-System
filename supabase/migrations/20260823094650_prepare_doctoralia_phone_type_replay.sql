-- Replay-only compatibility shim for the already-applied production migration
-- 20260823094700_widen_doctoralia_raw_phone_compat.sql.
--
-- Fresh database replays reach 094700 with three views depending (directly or
-- transitively) on doctoralia_raw.phone_primary / phone_secondary. PostgreSQL
-- refuses to alter a column type while those view rules exist (SQLSTATE 0A000).
--
-- Production already records 094700 as applied. In that case this migration is
-- intentionally a no-op: no live view is dropped and no marker is created.

DO $$
DECLARE
  phone_widening_already_applied boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260823094700'
  )
  INTO phone_widening_already_applied;

  IF phone_widening_already_applied THEN
    RETURN;
  END IF;

  -- Marker survives the 094700 migration transaction and tells 094750 that this
  -- is a clean replay path that must restore the views. It is removed by 094750.
  CREATE TABLE IF NOT EXISTS public._nvx_replay_20260823094700 (
    marker boolean PRIMARY KEY DEFAULT true CHECK (marker)
  );
  REVOKE ALL ON TABLE public._nvx_replay_20260823094700 FROM PUBLIC, anon, authenticated;

  -- Drop leaf-to-root, explicitly. Do not CASCADE: the dependency graph at this
  -- historical replay point is known and intentionally bounded.
  DROP VIEW IF EXISTS public.vw_doctoralia_patient_ltv;
  DROP VIEW IF EXISTS public.vw_doctoralia_lead_traceability_unified;
  DROP VIEW IF EXISTS public.vw_doctoralia_trazabilidad_360;
END
$$;
