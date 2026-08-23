import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('playbooks execution counter contract', () => {
  it('loads run_count before incrementing it', () => {
    expect(source).toContain(".from('playbooks').select('id, title, run_count')");
    expect(source).toContain('run_count: Number(pb.run_count ?? 0) + 1');
  });

  it('does not use an any-cast fallback for the counter', () => {
    expect(source).not.toContain('(pb as any).run_count');
    expect(source).not.toContain('run_count + 1 || 1');
  });
});
