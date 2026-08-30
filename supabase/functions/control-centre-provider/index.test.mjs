import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/control-centre-provider/index.ts', 'utf8');

describe('Control Centre provider gateway contract', () => {
  it('uses the shared database cache, lease and breaker contract', () => {
    expect(source).toContain("nvx_control_centre_provider_begin_refresh");
    expect(source).toContain("nvx_control_centre_provider_finish_success");
    expect(source).toContain("nvx_control_centre_provider_finish_failure");
    expect(source).toContain("state.reason === 'fresh_cache'");
    expect(source).toContain('breaker_open_until');
    expect(source).toContain('failure_count');
  });

  it('routes Google through the canonical v25 health owner instead of legacy GAQL', () => {
    expect(source).toContain('/functions/v1/google-ads-health');
    expect(source).not.toContain('googleads.googleapis.com/v17');
    expect(source).not.toContain('GOOGLE_ADS_SERVICE_ACCOUNT');
    expect(source).not.toContain('GOOGLE_ADS_DEVELOPER_TOKEN');
  });

  it('keeps provider credentials server-side and authenticates the browser session', () => {
    expect(source).toContain('authClient.auth.getUser(token)');
    expect(source).toContain("p_name: 'REVOPS_INTERNAL_SECRET'");
    expect(source).not.toContain("'Access-Control-Allow-Origin': '*'");
    expect(source).toContain('Origin not allowed');
  });

  it('returns fail-visible live/stale/refreshing/unavailable envelopes', () => {
    expect(source).toContain("type ProviderEnvelopeStatus = 'live' | 'stale' | 'refreshing' | 'unavailable'");
    expect(source).toContain("state.reason === 'refresh_in_flight' && !hasCache");
    expect(source).toContain("status === 'refreshing' ? 202 : 200");
    expect(source).toContain('last_success_at');
    expect(source).toContain('age_seconds');
    expect(source).toContain('breaker_state');
  });

  it('logs breaker persistence failures instead of hiding them', () => {
    expect(source).toContain('error: failureError');
    expect(source).toContain("console.error('[control-centre-provider] breaker update failed', provider)");
  });
});
