import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/google-ads-daily-sync/index.ts', 'utf8');
const authSource = readFileSync('supabase/functions/_shared/google-ads-auth.ts', 'utf8');

describe('Google Ads Edge authentication contract', () => {
  it('delegates deterministic OAuth selection to the shared resolver', () => {
    expect(source).toContain('Deno.env.get("GOOGLE_ADS_CLIENT_ID")');
    expect(source).toContain('Deno.env.get("GOOGLE_ADS_CLIENT_SECRET")');
    expect(source).toContain('Deno.env.get("GOOGLE_ADS_REFRESH_TOKEN")');
    expect(source).toContain('resolveGoogleAdsAuth({');
    expect(source).toContain('oauthClientId: OAUTH_CLIENT_ID');
    expect(source).toContain('oauthClientSecret: OAUTH_CLIENT_SECRET');
    expect(source).toContain('oauthRefreshToken: OAUTH_REFRESH_TOKEN');
    expect(source).toContain('serviceAccountRaw: SERVICE_ACCOUNT_RAW');

    expect(authSource).toContain('googleAdsRefreshConfigState');
    expect(authSource).toContain('refreshState === "partial"');
    expect(authSource).toContain('Google Ads OAuth refresh configuration is incomplete');
    expect(authSource).toContain('mode: "oauth_refresh"');
    expect(authSource).toContain('mode: "service_account"');
  });

  it('preserves the standard service-account JWT bearer grant in the shared implementation', () => {
    expect(authSource).toContain('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(authSource).not.toContain('urn:ietf:params:oauth-type:jwt-bearer');
    expect(authSource).toContain('const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords"');
  });

  it('does not send pageSize to Google Ads Search API', () => {
    expect(source).not.toContain('PAGE_SIZE');
    expect(source).toContain('const body: Record<string, unknown> = { query };');
    expect(source).not.toMatch(/pageSize\s*:/);
  });

  it('keeps OAuth credentials server-side and exposes only the safe auth mode', () => {
    expect(authSource).toContain('refresh_token: refreshToken');
    expect(source).not.toContain('auth_token:');
    expect(source).not.toMatch(/console\.(?:log|error|warn)\([^\n]*OAUTH_(?:CLIENT_SECRET|REFRESH_TOKEN)/);
    expect(authSource).not.toMatch(/console\.(?:log|error|warn)\([^\n]*(?:clientSecret|refreshToken|privateKey)/);

    expect(source).toMatch(/return reply\(success \? 200 : 502, \{\s*success,\s*provider: "google_ads",\s*api_version: API_VERSION,\s*auth_mode: googleAuth\.mode,\s*date_range: range,\s*accounts: summaries,\s*failures,\s*\}\);/);
    expect(source).toMatch(/return reply\(failure\.status, \{\s*success: false,\s*provider: "google_ads",\s*api_version: API_VERSION,\s*kind: failure\.kind,\s*message: failure\.message\.replace\(\/\\s\+\/g, " "\)\.slice\(0, 500\),\s*\}\);/);
  });
});
