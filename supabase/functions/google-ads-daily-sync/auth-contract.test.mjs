import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/google-ads-daily-sync/index.ts', 'utf8');

describe('Google Ads Edge authentication contract', () => {
  it('supports complete OAuth refresh-token auth before service-account fallback', () => {
    expect(source).toContain('Deno.env.get("GOOGLE_ADS_CLIENT_ID")');
    expect(source).toContain('Deno.env.get("GOOGLE_ADS_CLIENT_SECRET")');
    expect(source).toContain('Deno.env.get("GOOGLE_ADS_REFRESH_TOKEN")');
    expect(source).toContain('const hasAnyOAuth = Boolean(OAUTH_CLIENT_ID || OAUTH_CLIENT_SECRET || OAUTH_REFRESH_TOKEN)');
    expect(source).toContain('const hasAllOAuth = Boolean(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET && OAUTH_REFRESH_TOKEN)');
    expect(source).toContain('Google Ads OAuth configuration is incomplete');
    expect(source).toContain('mode: "oauth_refresh"');
    expect(source).toContain('mode: "service_account"');
  });

  it('preserves the standard service-account JWT bearer grant', () => {
    expect(source).toContain('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(source).not.toContain('urn:ietf:params:oauth-type:jwt-bearer');
  });

  it('does not send pageSize to Google Ads Search API', () => {
    expect(source).not.toContain('PAGE_SIZE');
    expect(source).toContain('const body: Record<string, unknown> = { query };');
    expect(source).not.toMatch(/pageSize\s*:/);
  });

  it('uses OAuth credentials server-side but exposes only the safe auth mode', () => {
    expect(source).toContain('refresh_token: OAUTH_REFRESH_TOKEN');
    expect(source).not.toContain('auth_token:');
    expect(source).not.toMatch(/console\.(?:log|error|warn)\([^\n]*OAUTH_(?:CLIENT_SECRET|REFRESH_TOKEN)/);

    expect(source).toMatch(/return reply\(success \? 200 : 502, \{\s*success,\s*provider: "google_ads",\s*api_version: API_VERSION,\s*auth_mode: googleAuth\.mode,\s*date_range: range,\s*accounts: summaries,\s*failures,\s*\}\);/);
    expect(source).toMatch(/return reply\(failure\.status, \{\s*success: false,\s*provider: "google_ads",\s*api_version: API_VERSION,\s*kind: failure\.kind,\s*message: failure\.message\.replace\(\/\\s\+\/g, " "\)\.slice\(0, 500\),\s*\}\);/);
  });
});
