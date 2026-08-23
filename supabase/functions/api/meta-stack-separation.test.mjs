import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('Meta canonical/legacy stack separation', () => {
  it('routes lead webhooks across legacy and canonical services', () => {
    expect(source).toContain(".in('service', ['meta', 'meta_ads'])");
    expect(source).toContain('metaIntegrationPageIds');
    expect(source).toContain("credentialService = matchingIntg.service === 'meta_ads' ? 'meta_ads' : 'meta'");
  });

  it('supports legacy and canonical app secrets', () => {
    expect(source).toContain('META_CANONICAL_APP_SECRET');
    expect(source).toContain('metaWebhookSignatureMatches');
    expect(source).toContain('[META_APP_SECRET, META_CANONICAL_APP_SECRET]');
  });

  it('uses the matching app secret for canonical lead retrieval', () => {
    expect(source).toContain('metaAppSecretForService(credentialService)');
    expect(source).toContain('appSecretOverride === undefined ? META_APP_SECRET : appSecretOverride');
  });
});
