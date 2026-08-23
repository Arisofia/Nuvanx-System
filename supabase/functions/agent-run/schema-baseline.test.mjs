import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(
  fileURLToPath(new URL('../../migrations/20260823212000_reconcile_agent_outputs_schema_baseline.sql', import.meta.url)),
  'utf8',
);

describe('agent_outputs schema baseline', () => {
  it('is versioned before the playbooks baseline without rewriting an applied migration', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.agent_outputs');
    expect(migration).toContain('20260823213000');
    expect(migration).not.toContain('ALTER TABLE public.playbook_executions');
  });

  it('recreates the production columns and status contract needed by Edge callers', () => {
    expect(migration).toContain('user_id uuid NOT NULL');
    expect(migration).toContain('clinic_id uuid');
    expect(migration).toContain('agent_type varchar NOT NULL');
    expect(migration).toContain("input_context jsonb DEFAULT '{}'::jsonb");
    expect(migration).toContain("output_text text DEFAULT ''::text");
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

  it('restores the observed RLS and grants without granting anon table access', () => {
    expect(migration).toContain('ALTER TABLE public.agent_outputs ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY agent_outputs_insert');
    expect(migration).toContain('CREATE POLICY agent_outputs_select_clinic');
    expect(migration).toContain('CREATE POLICY agent_outputs_service_all');
    expect(migration).toContain('CREATE POLICY deny_anonymous_authenticated');
    expect(migration).toContain('REVOKE ALL ON TABLE public.agent_outputs FROM anon');
    expect(migration).toContain('GRANT ALL ON TABLE public.agent_outputs TO authenticated, service_role');
  });
});
