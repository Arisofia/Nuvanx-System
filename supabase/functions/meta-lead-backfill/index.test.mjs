import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/meta-lead-backfill/index.ts', 'utf8');

describe('Meta lead backfill lineage contract', () => {
  it('uses Page-owned Lead Ads forms and retains the provider form name', () => {
    expect(source).toContain('`/${pageId}/leadgen_forms`');
    expect(source).toContain('fields: "id,name"');
    expect(source).toContain('form_name: raw.form_name ?? form.name ?? null');
  });

  it('persists form_name on both existing and newly recovered lead episodes', () => {
    expect(source).toContain('form_name: existing.form_name || raw.form_name || null');
    expect(source).toContain('form_name: raw.form_name || null');
    expect(source).toContain('form_name,meta_form_id');
  });

  it('keeps historical recovery bound to canonical meta_ads ownership', () => {
    expect(source).toContain('.eq("service", "meta_ads")');
    expect(source).toContain('.eq("status", "connected")');
    expect(source).toContain('Expected exactly one canonical connected meta_ads integration for user');
  });
});
