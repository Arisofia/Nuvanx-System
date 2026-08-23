-- =============================================================================
-- Make playbook run_count increments concurrency-safe for existing Edge paths.
--
-- Both the canonical API handler and the legacy playbooks Edge Function record
-- an execution by updating last_run_at. The canonical API still sends a
-- read-modify-write run_count value, so concurrent executions could otherwise
-- overwrite each other with the same counter.
--
-- PostgreSQL is the authoritative counter owner. A BEFORE UPDATE OF last_run_at
-- trigger always rewrites run_count from the locked OLD row. UPDATE OF is based
-- on the target column list, so even two executions carrying the same timestamp
-- increment independently. Administrative repairs that update run_count without
-- targeting last_run_at are deliberately unaffected.
--
-- Production enforces run_count NOT NULL DEFAULT 0. COALESCE is retained here
-- only for drifted databases where a historical playbooks table may exist with a
-- weaker nullable contract before the missing baseline migration is reconciled.
--
-- The repository currently does not contain the historical migration that
-- creates public.playbooks. Keep clean/preview migration replay non-fatal by
-- installing the trigger only when that relation exists; canonicalizing the
-- missing playbooks baseline is a separate schema-parity fix.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.nvx_atomic_playbook_run_increment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  NEW.run_count := COALESCE(OLD.run_count, 0) + 1;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.nvx_atomic_playbook_run_increment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nvx_atomic_playbook_run_increment() FROM anon;
REVOKE EXECUTE ON FUNCTION public.nvx_atomic_playbook_run_increment() FROM authenticated;

DO $do$
BEGIN
  IF to_regclass('public.playbooks') IS NULL THEN
    RAISE NOTICE 'Skipping playbook run counter trigger: public.playbooks does not exist in this database';
  ELSE
    EXECUTE 'DROP TRIGGER IF EXISTS trg_playbooks_atomic_run_increment ON public.playbooks';
    EXECUTE $sql$
      CREATE TRIGGER trg_playbooks_atomic_run_increment
      BEFORE UPDATE OF last_run_at ON public.playbooks
      FOR EACH ROW
      EXECUTE FUNCTION public.nvx_atomic_playbook_run_increment()
    $sql$;
    EXECUTE $sql$
      COMMENT ON TRIGGER trg_playbooks_atomic_run_increment ON public.playbooks IS
        'Serializes playbook execution counters for every UPDATE targeting last_run_at; run_count-only administrative repairs remain explicit.'
    $sql$;
  END IF;
END;
$do$;

COMMENT ON FUNCTION public.nvx_atomic_playbook_run_increment() IS
  'Internal trigger helper: increments playbooks.run_count from the locked OLD row whenever an execution advances last_run_at.';
