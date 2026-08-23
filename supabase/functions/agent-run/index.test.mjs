import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('agent-run typing contract', () => {
  it('keeps clinic lookup on the already inferred Supabase client without any casts', () => {
    expect(source).toContain("supabase.from('users').select('clinic_id').eq('id', user.id).single()");
    expect(source).toContain('const clinicId = owner?.clinic_id ?? null');
    expect(source).not.toContain('SupabaseClientLike');
    expect(source).not.toContain('adminClient: any');
  });

  it('keeps provider failures on the existing persisted 500 path without any casts', () => {
    expect(source).toContain('catch (err: unknown)');
    expect(source).not.toContain('catch (err: any)');
    expect(source).toContain('const message = safeErrorMessage(err)');
    expect(source).toContain('error_message: message');
    expect(source).toContain('return json({ success: false, message, output_id: failOutput?.id }, 500)');
  });

  it('keeps error coercion fail-safe', () => {
    expect(source).toContain('function safeErrorMessage(error: unknown): string');
    expect(source).toMatch(/function safeErrorMessage\(error: unknown\): string \{[\s\S]*?try \{[\s\S]*?String\(error\)[\s\S]*?catch \{[\s\S]*?return 'AI provider request failed';[\s\S]*?\}/);
  });
});
