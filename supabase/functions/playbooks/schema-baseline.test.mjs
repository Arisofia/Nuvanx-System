import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(
  fileURLToPath(new URL('../../migrations/20260823213000_reconcile_playbooks_schema_baseline.sql', import.meta.url)),
  'utf8',
);

describe('playbooks schema baseline', () => {
  it('creates both missing canonical tables with the production counter contract', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.playbooks');
    expect(migration).toContain('run_count integer NOT NULL DEFAULT 0');
    expect(migration).toContain('last_run_at timestamptz');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.playbook_executions');
    expect(migration).toContain("status text NOT NULL DEFAULT 'triggered'");
    expect(migration).toContain("metadata jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("output_data jsonb DEFAULT '{}'::jsonb");
  });

  it('restores production foreign-key and index relationships without inventing a user FK', () => {
    expect(migration).toContain('playbooks_owner_user_id_fkey');
    expect(migration).toContain('REFERENCES public.users(id) ON DELETE SET NULL');
    expect(migration).toContain('playbook_executions_playbook_id_fkey');
    expect(migration).toContain('REFERENCES public.playbooks(id) ON DELETE CASCADE');
    expect(migration).toContain('playbook_executions_agent_output_id_fkey');
    expect(migration).toContain('REFERENCES public.agent_outputs(id)');
    expect(migration).toContain('agent_runs_playbook_id_fkey');
    expect(migration).not.toMatch(/FOREIGN KEY \(user_id\)/);
    expect(migration).toContain('playbook_executions_created_at_idx');
    expect(migration).toContain('idx_playbook_executions_agent_output_id');
  });

  it('recreates the observed RLS policies and service-role access model', () => {
    expect(migration).toContain('ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE public.playbook_executions ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY playbooks_service_role');
    expect(migration).toContain('CREATE POLICY playbook_executions_service_role');
    expect(migration).toContain('CREATE POLICY playbook_executions_user');
    expect(migration).toContain('CREATE POLICY deny_anonymous_authenticated');
    expect(migration).toContain('(SELECT auth.uid()) = user_id');
    expect(migration).toContain("(SELECT auth.jwt()) ->> 'is_anonymous'");
  });

  it('installs the atomic trigger after a clean replay creates playbooks', () => {
    expect(migration).toContain('NEW.run_count := COALESCE(OLD.run_count, 0) + 1');
    expect(migration).toContain('DROP TRIGGER IF EXISTS trg_playbooks_atomic_run_increment ON public.playbooks');
    expect(migration).toContain('BEFORE UPDATE OF last_run_at ON public.playbooks');
    expect(migration).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });
});
