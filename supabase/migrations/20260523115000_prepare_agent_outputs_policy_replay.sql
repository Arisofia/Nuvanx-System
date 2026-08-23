-- =============================================================================
-- Prepare clean replay for the historical agent_outputs policy lifecycle.
--
-- 20260504125950 is already applied in production and therefore immutable. It
-- restores the current `agent_outputs_insert` policy so healthy production is
-- complete immediately, but on a clean replay the historical migration
-- 20260523120000 later creates a policy with the same name without first dropping
-- it. This compatibility shim runs immediately before that historical migration.
--
-- Production safety: if 20260523120000 is already recorded in the Supabase
-- migration ledger, this migration is a no-op and preserves the current policy.
-- Clean replay: while 20260523120000 is still pending, drop only the conflicting
-- policy so that the historical migration can recreate it as originally intended.
-- =============================================================================

DO $do$
DECLARE
  historical_policy_migration_applied boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260523120000'
  )
  INTO historical_policy_migration_applied;

  IF NOT historical_policy_migration_applied
     AND to_regclass('public.agent_outputs') IS NOT NULL THEN
    DROP POLICY IF EXISTS agent_outputs_insert ON public.agent_outputs;
  END IF;
END;
$do$;
