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
  it('removes the unsafe any fallback in the standalone Edge path', () => {
    expect(source).toContain(".from('playbooks').select('id, title, run_count')");
    expect(source).toContain('run_count: Number(pb.run_count ?? 0) + 1');
    expect(source).not.toContain('(pb as any).run_count');
    expect(source).not.toContain('run_count + 1 || 1');
  });

  it('serializes execution increments in PostgreSQL for both Edge paths', () => {
    expect(source).toMatch(/update\(\{ run_count: Number\(pb\.run_count \?\? 0\) \+ 1, last_run_at:/);
    expect(apiSource).toMatch(/update\(\{ run_count: \(pb\.run_count \|\| 0\) \+ 1, last_run_at:/);
    expect(migration).toContain('BEFORE UPDATE OF run_count ON public.playbooks');
    expect(migration).toContain('NEW.last_run_at IS DISTINCT FROM OLD.last_run_at');
    expect(migration).toContain('NEW.run_count := OLD.run_count + 1');
  });

  it('keeps explicit run_count-only administrative repairs outside the trigger rewrite', () => {
    expect(migration).toContain('IF NEW.last_run_at IS DISTINCT FROM OLD.last_run_at THEN');
    expect(migration).toContain('RETURN NEW;');
  });
});
