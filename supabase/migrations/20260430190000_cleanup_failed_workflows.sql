-- Cleanup historical workflow executions that failed, keeping only the most recent ones
-- "Elimina todos los workflows historicos que fallaron, excepto los últimos"

-- 1. Cleanup failed playbook executions (cascades to agent_runs and agent_run_steps)
-- Keep only the 50 most recent failures
DELETE FROM public.playbook_executions
WHERE status = 'failed'
  AND id NOT IN (
    SELECT id FROM public.playbook_executions
    WHERE status = 'failed'
    ORDER BY created_at DESC
    LIMIT 50
  );

-- 2. Cleanup standalone agent_runs that failed
-- Keep only the 50 most recent failures/dead_letters
DELETE FROM public.agent_runs
WHERE status IN ('failed', 'dead_letter')
  AND id NOT IN (
    SELECT id FROM public.agent_runs
    WHERE status IN ('failed', 'dead_letter')
    ORDER BY created_at DESC
    LIMIT 50
  );

-- 3. Cleanup failed monitoring commands
-- Keep only the 50 most recent failures
DELETE FROM monitoring.commands
WHERE status = 'failed'
  AND id NOT IN (
    SELECT id FROM monitoring.commands
    WHERE status = 'failed'
    ORDER BY created_at DESC
    LIMIT 50
  );
