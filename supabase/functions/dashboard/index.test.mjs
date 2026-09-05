import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('dashboard typing contract', () => {
  it('keeps clinic lookup on the inferred Supabase client without any casts', () => {
    expect(source).toContain(".from('users')");
    expect(source).toContain(".select('clinic_id')");
    expect(source).toContain(".eq('id', userId)");
    expect(source).toContain('.maybeSingle()');
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

  it('keeps Meta attribution scoped and preserves leadgen identifiers', () => {
    expect(source).toContain(".select('leadgen_id, campaign_id, form_id, captured_at, leads!inner(user_id, clinic_id)')");
    expect(source).toContain(".eq('leads.user_id', userId)");
    expect(source).toContain(".eq('leads.clinic_id', clinicId)");
  });

  it('fails closed when the owner or any dashboard query fails', () => {
    expect(source).toContain('if (ownerError) return json({ success: false, message: \'Failed to fetch user context\' }, 500);');
    expect(source).toContain('if (queryError) {');
    expect(source).toContain("return json({ success: false, message: 'Failed to load dashboard data' }, 500);");
  });
});
