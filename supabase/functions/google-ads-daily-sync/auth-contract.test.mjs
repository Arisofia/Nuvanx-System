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

  it('uses the refresh token only in the server-side OAuth request and reports only the safe auth mode', () => {
    expect(source).toContain('refresh_token: OAUTH_REFRESH_TOKEN');
    expect(source).toContain('auth_mode: googleAuth.mode');
    expect(source).not.toContain('auth_token:');
    expect(source).not.toMatch(/console\.(?:log|error|warn)\([^\n]*OAUTH_(?:CLIENT_SECRET|REFRESH_TOKEN)/);

    const successReply = source.match(/return reply\(success \? 200 : 502, \{([\s\S]*?)\n\s*\}\);/);
    expect(successReply?.[1] || '').toContain('auth_mode: googleAuth.mode');
    expect(successReply?.[1] || '').not.toMatch(/OAUTH_(?:CLIENT_SECRET|REFRESH_TOKEN)|accessToken|googleAuth\.token/);

    const failureReply = source.match(/return reply\(failure\.status, \{([\s\S]*?)\n\s*\}\);/);
    expect(failureReply?.[1] || '').not.toMatch(/OAUTH_(?:CLIENT_SECRET|REFRESH_TOKEN)|accessToken|googleAuth\.token/);
  });
});
