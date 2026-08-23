import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const earlyFile = '20260504125960_reconcile_agent_runs_schema_baseline.sql';
const playbooksFile = '20260823213000_reconcile_playbooks_schema_baseline.sql';
const finalizerFile = '20260823214000_finalize_agent_runs_schema_baseline.sql';
const cleanupFile = '20260823214100_cleanup_agent_runs_replay_indexes.sql';
const early = readFileSync(join(migrationsDir, earlyFile), 'utf8');
const playbooks = readFileSync(join(migrationsDir, playbooksFile), 'utf8');
const finalizer = readFileSync(join(migrationsDir, finalizerFile), 'utf8');
const cleanup = readFileSync(join(migrationsDir, cleanupFile), 'utf8');

describe('agent_runs schema baseline', () => {
  it('orders the early relation before historical advisor and playbooks references', () => {
    expect(earlyFile > '20260504125950_reconcile_agent_outputs_schema_baseline.sql').toBe(true);
    expect(earlyFile < '20260508120000_fix_remaining_advisor_fk_indexes.sql').toBe(true);
    expect(earlyFile < playbooksFile).toBe(true);
    expect(finalizerFile > playbooksFile).toBe(true);
    expect(cleanupFile > finalizerFile).toBe(true);
  });

  it('restores the production table contract before circular FK targets exist', () => {
    expect(early).toContain('CREATE TABLE IF NOT EXISTS public.agent_runs');
    expect(early).toContain('execution_id uuid NOT NULL');
    expect(early).toContain('user_id uuid NOT NULL');
    expect(early).toContain('playbook_id uuid');
    expect(early).toContain("status text NOT NULL DEFAULT 'running'::text");
    expect(early).toContain("metadata jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(early).toContain('agent_runs_status_check');
    expect(early).toContain("'dead_letter'::text");
    expect(early).not.toContain('REFERENCES public.playbook_executions');
    expect(early).not.toContain('REFERENCES public.playbooks');
  });

  it('restores production indexes, RLS and service-role policy without inventing user access policies', () => {
    expect(early).toContain('agent_runs_created_at_idx');
    expect(early).toContain('agent_runs_user_id_idx');
    expect(early).toContain('idx_agent_runs_execution_id');
    expect(early).toContain('idx_agent_runs_playbook_id');
    expect(early).toContain('ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY');
    expect(early).toContain('CREATE POLICY agent_runs_service_role');
    expect(early).toContain('TO service_role');
    expect(early).toContain('GRANT ALL ON TABLE public.agent_runs TO anon, authenticated, service_role');
    expect(early).not.toMatch(/CREATE POLICY .*authenticated/);
  });

  it('lets the applied playbooks migration add its existing playbook FK path', () => {
    expect(playbooks).toContain("to_regclass('public.agent_runs') IS NOT NULL");
    expect(playbooks).toContain('agent_runs_playbook_id_fkey');
    expect(playbooks).toContain('FOREIGN KEY (playbook_id) REFERENCES public.playbooks(id) ON DELETE SET NULL');
  });

  it('finalizes both validated production foreign-key relationships after their targets exist', () => {
    expect(finalizer).toContain('agent_runs_execution_id_fkey');
    expect(finalizer).toContain('FOREIGN KEY (execution_id)');
    expect(finalizer).toContain('REFERENCES public.playbook_executions(id)');
    expect(finalizer).toContain('ON DELETE CASCADE');
    expect(finalizer).toContain('agent_runs_playbook_id_fkey');
    expect(finalizer).toContain('FOREIGN KEY (playbook_id)');
    expect(finalizer).toContain('REFERENCES public.playbooks(id)');
    expect(finalizer).toContain('ON DELETE SET NULL');
  });

  it('removes only the known replay-created duplicate indexes after canonical indexes and FKs exist', () => {
    expect(cleanup).toContain('DROP INDEX IF EXISTS public.adv_fk_agent_runs_execution_id');
    expect(cleanup).toContain('DROP INDEX IF EXISTS public.adv_fk_agent_runs_playbook_id');
    expect(cleanup).toContain('DROP INDEX IF EXISTS public.idx_agent_runs_execution_id_fk');
    expect(cleanup).toContain('DROP INDEX IF EXISTS public.idx_agent_runs_playbook_id_fk');
    expect(cleanup).not.toContain('DROP INDEX IF EXISTS public.idx_agent_runs_execution_id;');
    expect(cleanup).not.toContain('DROP INDEX IF EXISTS public.idx_agent_runs_playbook_id;');
    expect(cleanup).not.toContain('DROP INDEX IF EXISTS public.agent_runs_created_at_idx;');
    expect(cleanup).not.toContain('DROP INDEX IF EXISTS public.agent_runs_user_id_idx;');
  });
});
