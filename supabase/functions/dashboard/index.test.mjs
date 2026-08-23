import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('dashboard typing contract', () => {
  it('types the Supabase admin client without any', () => {
    expect(source).toContain('type SupabaseClientLike = ReturnType<typeof createClient>');
    expect(source).toContain('resolveClinicId(adminClient: SupabaseClientLike, userId: string)');
    expect(source).not.toContain('resolveClinicId(adminClient: any');
  });

  it('uses typed stage and template accumulators', () => {
    expect(source).toContain('STAGES.reduce<Record<string, number>>');
    expect(source).toContain('type TemplateBreakdown = Record<string, { count: number; revenue: number }>');
    expect(source).toContain('settlements.reduce<TemplateBreakdown>');
    expect(source).not.toContain('{} as any');
    expect(source).not.toContain('(acc: any');
  });
});
