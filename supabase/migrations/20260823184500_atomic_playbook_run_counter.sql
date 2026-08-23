-- =============================================================================
-- Make playbook run_count increments concurrency-safe for existing Edge paths.
--
-- Both the canonical API handler and the legacy playbooks Edge Function update
-- run_count together with last_run_at after recording an execution. Those
-- callers historically performed a read-modify-write sequence, so concurrent
-- executions could overwrite each other with the same counter value.
--
-- This BEFORE UPDATE trigger keeps the existing caller contract but makes the
-- increment authoritative inside PostgreSQL: whenever an UPDATE explicitly
-- targets run_count and also advances last_run_at, the stored value becomes
-- OLD.run_count + 1 under the row lock held by PostgreSQL. Direct administrative
-- run_count repairs that do not modify last_run_at keep their explicit value.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.nvx_atomic_playbook_run_increment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF NEW.last_run_at IS DISTINCT FROM OLD.last_run_at THEN
    NEW.run_count := OLD.run_count + 1;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.nvx_atomic_playbook_run_increment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nvx_atomic_playbook_run_increment() FROM anon;
REVOKE EXECUTE ON FUNCTION public.nvx_atomic_playbook_run_increment() FROM authenticated;

DROP TRIGGER IF EXISTS trg_playbooks_atomic_run_increment ON public.playbooks;
CREATE TRIGGER trg_playbooks_atomic_run_increment
BEFORE UPDATE OF run_count ON public.playbooks
FOR EACH ROW
EXECUTE FUNCTION public.nvx_atomic_playbook_run_increment();

COMMENT ON FUNCTION public.nvx_atomic_playbook_run_increment() IS
  'Internal trigger helper: serializes playbook execution counters as OLD.run_count + 1 whenever callers update run_count together with last_run_at.';

COMMENT ON TRIGGER trg_playbooks_atomic_run_increment ON public.playbooks IS
  'Prevents lost playbook run_count increments under concurrent Edge executions while preserving explicit run_count-only administrative repairs.';
