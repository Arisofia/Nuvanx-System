import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('dashboard typing contract', () => {
  it('keeps clinic lookup on the inferred Supabase client without any casts', () => {
    expect(source).toContain("supabase.from('users').select('clinic_id').eq('id', userId).single()");
    expect(source).toContain('const clinicId = owner?.clinic_id ?? null');
    expect(source).not.toContain('SupabaseClientLike');
    expect(source).not.toContain('adminClient: any');
  });

  it('uses typed stage and template accumulators', () => {
    expect(source).toContain('STAGES.reduce<Record<string, number>>');
    expect(source).toContain('type TemplateBreakdown = Record<string, { count: number; revenue: number }>');
    expect(source).toContain('settlements.reduce<TemplateBreakdown>');
    expect(source).not.toContain('{} as any');
    expect(source).not.toContain('(acc: any');
  });
});
