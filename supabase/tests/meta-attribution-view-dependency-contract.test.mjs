import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260904180500_enforce_meta_lead_attribution_invariant.sql',
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*--.*$/gm, '');

describe('Meta attribution migration remains compatible with dependent reporting views', () => {
  it('never rewrites meta_attribution column types after reporting views may depend on them', () => {
    expect(migration).not.toMatch(
      /alter\s+table\s+public\.meta_attribution[\s\S]*?alter\s+column\s+[a-z_]+\s+type\b/i,
    );
  });

  it('enforces the historical TEXT replay contract through constraints instead of type rewrites', () => {
    expect(migration).toContain('alter column leadgen_id set not null');
    expect(migration).toContain('alter column captured_at set not null');

    for (const constraint of [
      'meta_attribution_leadgen_id_length_chk',
      'meta_attribution_page_id_length_chk',
      'meta_attribution_form_id_length_chk',
      'meta_attribution_campaign_id_length_chk',
      'meta_attribution_campaign_name_length_chk',
      'meta_attribution_adset_id_length_chk',
      'meta_attribution_adset_name_length_chk',
      'meta_attribution_ad_id_length_chk',
      'meta_attribution_ad_name_length_chk',
    ]) {
      expect(migration, constraint).toContain(`add constraint ${constraint}`);
    }
  });

  it('keeps the fail-closed preflight ahead of constraint installation', () => {
    const preflight = migration.indexOf("raise exception 'Meta attribution schema contract rejected");
    const constraints = migration.indexOf('add constraint meta_attribution_leadgen_id_length_chk');
    expect(preflight).toBeGreaterThan(-1);
    expect(constraints).toBeGreaterThan(preflight);
  });

  it('disallows empty or whitespace-only leadgen_id in the check constraint', () => {
    expect(migration).toMatch(
      /add\s+constraint\s+meta_attribution_leadgen_id_length_chk\s+check\s*\(\s*nullif\s*\(\s*btrim\s*\(\s*leadgen_id::text\s*\)\s*,\s*''\s*\)\s+is\s+not\s+null/i,
    );
  });
});
