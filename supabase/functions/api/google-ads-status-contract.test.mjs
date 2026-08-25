import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const api = readFileSync('supabase/functions/api/index.ts', 'utf8');
const checker = readFileSync('scripts/check-google-ads-db.js', 'utf8');
const baselineMigration = readFileSync('supabase/migrations/20260825082322_create_google_ads_connection_status_view.sql', 'utf8');
const diagnosticsMigration = readFileSync('supabase/migrations/20260825090205_fix_google_ads_connection_status_diagnostics.sql', 'utf8');

describe('Google Ads status output contract', () => {
  it('serves authenticated per-user status without credential material', () => {
    const start = api.indexOf('async function handleGoogleAdsStatusGet');
    const end = api.indexOf('async function handleGoogleAdsInsightsGet', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = api.slice(start, end);
    expect(section).toContain(".from('vw_google_ads_connection_status')");
    expect(section).toContain(".eq('user_id', userId)");
    expect(section).toContain('lastErrorPresent');
    expect(section).not.toContain('encrypted_key');
    expect(section).not.toContain('integration_id');
    expect(api).toContain("['google-ads|status|GET', handleGoogleAdsStatusGet]");
  });

  it('keeps the database surface server-only and secret-free', () => {
    expect(baselineMigration).toContain('with (security_invoker = true)');
    expect(diagnosticsMigration).toContain('with (security_invoker = true)');
    expect(diagnosticsMigration).toContain('revoke all on public.vw_google_ads_connection_status from authenticated');
    expect(diagnosticsMigration).toContain('grant select on public.vw_google_ads_connection_status to service_role');
    expect(baselineMigration).not.toContain('encrypted_key');
    expect(diagnosticsMigration).not.toContain('encrypted_key');
  });

  it('diagnoses credential-only states and normalizes customer IDs', () => {
    expect(diagnosticsMigration).toContain("select user_id from public.credentials where service = 'google_ads'");
    expect(diagnosticsMigration).toContain('union');
    expect(diagnosticsMigration).toContain("'credential_only'::character varying(32)");
    expect(diagnosticsMigration).toContain('nullif(btrim(coalesce(');
    expect(diagnosticsMigration).toContain("c.metadata->>'customerId'");
  });

  it('makes the CLI consume the same canonical view', () => {
    expect(checker).toContain(".from('vw_google_ads_connection_status')");
    expect(checker).not.toContain(".from('credentials')");
    expect(checker).not.toContain(".from('integrations')");
    expect(checker).not.toContain('encrypted_key');
  });
});
