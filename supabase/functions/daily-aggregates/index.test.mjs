import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('daily-aggregates external-data typing', () => {
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

  it('keeps campaign ranking and daily insight state explicitly typed', () => {
    expect(source).toContain('type CampaignRankingEntry =');
    expect(source).toContain('let processedRanking: CampaignRankingEntry[] = []');
    expect(source).toContain('const dailyInsights: DailyInsights =');
  });

  it('narrows Gemini responses instead of traversing untyped JSON directly', () => {
    expect(source).toContain('function geminiText(value: unknown)');
    expect(source).toContain('const gData: unknown = await gRes.json()');
    expect(source).toContain('geminiText(gData)');
  });
});
