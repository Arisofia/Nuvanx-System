import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const baselineFile = '20260504125950_reconcile_agent_outputs_schema_baseline.sql';
const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const migration = readFileSync(join(migrationsDir, baselineFile), 'utf8');

const agentOutputsMigrationRefs = readdirSync(migrationsDir)
  .filter((filename) => filename.endsWith('.sql') && filename !== baselineFile)
  .filter((filename) => readFileSync(join(migrationsDir, filename), 'utf8').includes('agent_outputs'))
  .sort();

describe('agent_outputs schema baseline', () => {
  it('runs after its preview dependencies and before every later agent_outputs migration reference', () => {
    expect(baselineFile > '20260504125900_preview_core_tables.sql').toBe(true);
    expect(agentOutputsMigrationRefs.length).toBeGreaterThan(0);
    expect(agentOutputsMigrationRefs.every((filename) => filename > baselineFile)).toBe(true);
    expect(agentOutputsMigrationRefs).toContain('20260823213000_reconcile_playbooks_schema_baseline.sql');
    expect(migration).not.toContain('ALTER TABLE public.playbook_executions');
  });

  it('recreates the production columns and the active agent-run compatibility contract', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.agent_outputs');
    expect(migration).toContain('user_id uuid NOT NULL');
    expect(migration).toContain('clinic_id uuid');
    expect(migration).toContain('agent_type varchar NOT NULL');
    expect(migration).toContain("input_context jsonb DEFAULT '{}'::jsonb");
    expect(migration).toContain("output_text text DEFAULT ''::text");
    expect(migration).toContain("output_data jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS output_data jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("output jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("metadata jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain('agent_outputs_status_check');
  });

  it('restores production foreign keys and indexes', () => {
    expect(migration).toContain('agent_outputs_user_id_fkey');
    expect(migration).toContain('REFERENCES public.users(id) ON DELETE CASCADE');
    expect(migration).toContain('agent_outputs_clinic_id_fkey');
    expect(migration).toContain('REFERENCES public.clinics(id)');
    expect(migration).toContain('agent_outputs_created_at_idx');
    expect(migration).toContain('agent_outputs_user_id_idx');
    expect(migration).toContain('idx_agent_outputs_clinic_id');
  });

  it('restores RLS without turning the anonymous guard into a permissive grant', () => {
    expect(migration).toContain('ALTER TABLE public.agent_outputs ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY agent_outputs_insert');
    expect(migration).toContain('CREATE POLICY agent_outputs_select_clinic');
    expect(migration).toContain('CREATE POLICY agent_outputs_service_all');
    expect(migration).toContain('CREATE POLICY deny_anonymous_authenticated');
    expect(migration).toMatch(/CREATE POLICY deny_anonymous_authenticated[\s\S]*?AS RESTRICTIVE[\s\S]*?FOR ALL[\s\S]*?TO authenticated/);
    expect(migration).toContain('REVOKE ALL ON TABLE public.agent_outputs FROM anon');
    expect(migration).toContain('GRANT ALL ON TABLE public.agent_outputs TO authenticated, service_role');
  });
});
