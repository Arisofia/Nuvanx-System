import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const baseline = readFileSync(
  fileURLToPath(new URL('../../migrations/20260504125950_reconcile_agent_outputs_schema_baseline.sql', import.meta.url)),
  'utf8',
);
const shim = readFileSync(
  fileURLToPath(new URL('../../migrations/20260523115000_prepare_agent_outputs_policy_replay.sql', import.meta.url)),
  'utf8',
);
const historical = readFileSync(
  fileURLToPath(new URL('../../migrations/20260523120000_resolve_remaining_rls_performance_warnings.sql', import.meta.url)),
  'utf8',
);

describe('agent_outputs policy replay compatibility', () => {
  it('places the compatibility shim immediately before the historical policy rewrite', () => {
    expect('20260523115000_prepare_agent_outputs_policy_replay.sql' < '20260523120000_resolve_remaining_rls_performance_warnings.sql').toBe(true);
    expect('20260523115000_prepare_agent_outputs_policy_replay.sql' > '20260523101000_add_leads_performance_indexes.sql').toBe(true);
  });

  it('keeps the already-applied baseline immutable and acknowledges the real name collision', () => {
    expect(baseline).toContain('CREATE POLICY agent_outputs_insert');
    expect(historical).toContain('CREATE POLICY agent_outputs_insert');
    expect(historical).not.toContain('DROP POLICY IF EXISTS agent_outputs_insert ON public.agent_outputs');
  });

  it('drops the conflicting policy only while the historical migration is still pending', () => {
    expect(shim).toContain('FROM supabase_migrations.schema_migrations');
    expect(shim).toContain("WHERE version = '20260523120000'");
    expect(shim).toContain('IF NOT historical_policy_migration_applied');
    expect(shim).toContain("to_regclass('public.agent_outputs') IS NOT NULL");
    expect(shim).toContain('DROP POLICY IF EXISTS agent_outputs_insert ON public.agent_outputs');
  });

  it('does not mutate any other agent_outputs policy', () => {
    expect(shim).not.toContain('DROP POLICY IF EXISTS agent_outputs_read_service');
    expect(shim).not.toContain('DROP POLICY IF EXISTS agent_outputs_select_clinic');
    expect(shim).not.toContain('DROP POLICY IF EXISTS deny_anonymous_authenticated');
  });
});
