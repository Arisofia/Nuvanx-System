import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('daily-aggregates Meta ingest contract', () => {
  it('contains no explicit any annotations or casts', () => {
    expect(source).not.toMatch(/:\s*any\b/);
    expect(source).not.toMatch(/\bany\[\]/);
    expect(source).not.toMatch(/\bas\s+any\b/);
    expect(source).not.toMatch(/<any>/);
  });

  it('narrows Meta Graph payloads before using insight rows and actions', () => {
    expect(source).toContain('type MetaAction =');
    expect(source).toContain('type MetaInsightRow =');
    expect(source).toContain('function normalizeMetaAction(value: unknown)');
    expect(source).toContain('function normalizeMetaInsightRow(value: unknown)');
    expect(source).toContain('function normalizeMetaInsightsResponse(value: unknown)');
    expect(source).toContain('const payload: unknown = await r.json()');
  });

  it('upserts the canonical daily fact key and fails closed on ingest errors', () => {
    expect(source).toContain(".from('meta_daily_insights').upsert(rows, { onConflict: 'clinic_id,ad_account_id,date' })");
    expect(source).toContain("kind: 'provider_error'");
    expect(source).toContain('if (result.failures.length > 0)');
    expect(source).toContain('success: false');
  });

  it('does not run a second insight writer or Gemini path inside ingestion', () => {
    expect(source).not.toContain('GEMINI_API_KEY');
    expect(source).not.toContain('agent_outputs');
    expect(source).not.toContain("agent_type: 'daily-meta-insight'");
    expect(source).not.toContain("agent_type: 'daily-insight'");
    expect(source).not.toContain('geminiText');
    expect(source).not.toContain('generativelanguage.googleapis.com');
  });

  it('rejects unknown actions instead of running an implicit legacy job', () => {
    expect(source).toContain("error: 'Unsupported action'");
    expect(source).toContain(', 422)');
  });
});
