import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
const apiSource = readFileSync(fileURLToPath(new URL('../api/index.ts', import.meta.url)), 'utf8');
const migration = readFileSync(
  fileURLToPath(new URL('../../migrations/20260823184500_atomic_playbook_run_counter.sql', import.meta.url)),
  'utf8',
);

describe('playbooks execution counter contract', () => {
  it('keeps the standalone Edge path free of a stale read-modify-write counter', () => {
    expect(source).toContain(".from('playbooks').select('id, title')");
    expect(source).toContain(".update({ last_run_at: new Date().toISOString() })");
    expect(source).not.toContain('(pb as any).run_count');
    expect(source).not.toMatch(/update\(\{[^}]*run_count/);
  });

  it('serializes execution increments in PostgreSQL for both Edge paths', () => {
    expect(apiSource).toMatch(/update\(\{ run_count: \(pb\.run_count \|\| 0\) \+ 1, last_run_at:/);
    expect(migration).toContain('BEFORE UPDATE OF last_run_at ON public.playbooks');
    expect(migration).toContain('NEW.run_count := OLD.run_count + 1');
    expect(migration).not.toContain('IS DISTINCT FROM');
  });

  it('keeps explicit run_count-only administrative repairs outside the trigger rewrite', () => {
    expect(migration).toContain('BEFORE UPDATE OF last_run_at ON public.playbooks');
    expect(migration).not.toContain('BEFORE UPDATE OF run_count ON public.playbooks');
    expect(migration).toContain('RETURN NEW;');
  });
});
