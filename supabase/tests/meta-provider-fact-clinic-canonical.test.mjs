import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const api = fs.readFileSync('supabase/functions/api/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260902100000_meta_provider_fact_clinic_canonical.sql', 'utf8');

describe('Meta provider facts are clinic-canonical at write time', () => {
  it('fails closed on unknown ownership or duplicate historical facts', () => {
    expect(migration).toContain('WHERE clinic_id IS NULL');
    expect(migration).toContain('HAVING count(*) > 1');
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).not.toMatch(/\bUPDATE\s+public\.meta_/i);
  });

  it('makes clinic ownership mandatory and adds canonical provider identities', () => {
    for (const table of [
      'meta_organic_daily',
      'meta_post_performance',
      'meta_ig_account_daily',
      'meta_ig_media_performance',
    ]) {
      expect(migration).toContain(`ALTER TABLE public.${table}`);
    }
    expect(migration.match(/ALTER COLUMN clinic_id SET NOT NULL/g)).toHaveLength(4);
    expect(migration).toContain('UNIQUE (clinic_id, page_id, date)');
    expect(migration).toContain('UNIQUE (clinic_id, page_id, post_id)');
    expect(migration).toContain('UNIQUE (clinic_id, ig_id, date)');
    expect(migration).toContain('UNIQUE (clinic_id, ig_id, media_id)');
  });

  it('targets the clinic-canonical keys from every writer', () => {
    expect(api).toContain("onConflict: 'clinic_id,page_id,date'");
    expect(api).toContain("onConflict: 'clinic_id,page_id,post_id'");
    expect(api).toContain("onConflict: 'clinic_id,ig_id,date'");
    expect(api).toContain("onConflict: 'clinic_id,ig_id,media_id'");
  });

  it('rejects Meta lead and provider-fact writes without a clinic', () => {
    expect(api).toContain("if (!clinicIdForLead) throw new Error('Clinic is required for Meta lead ingestion');");
    expect(api.match(/if \(!clinicId\) throw new Error\('Clinic is required for Meta provider fact persistence'\);/g)).toHaveLength(4);
  });

  it('fails webhook routing closed when a page maps to multiple connected integrations', () => {
    const start = api.indexOf('export async function processMetaLeadChange');
    const end = api.indexOf('/**\n * Fire CAPI Lead', start);
    const webhook = api.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(webhook).toContain('const explicitMatches = connected.filter');
    expect(webhook).toContain('if (explicitMatches.length > 1)');
    expect(webhook).toContain('Ambiguous connected integrations match incoming page_id');
    expect(webhook).not.toContain('connected.find(');
  });
});
