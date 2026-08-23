import { createHmac } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const env = new Map([
  ['META_APP_SECRET', 'legacy-secret'],
  ['META_CANONICAL_APP_SECRET', 'canonical-secret'],
]);

globalThis.Deno = {
  env: { get: (key) => env.get(key) },
  serve: vi.fn(),
};

let api;

beforeAll(async () => {
  api = await import('./index.ts');
});

beforeEach(() => {
  vi.restoreAllMocks();
});

function createAdminClient(integrations, credentialByService = {}) {
  const credentialServices = [];
  const from = vi.fn((table) => {
    if (table === 'integrations') {
      return {
        select: () => ({
          in: () => ({
            eq: async () => ({ data: integrations }),
          }),
        }),
      };
    }
    if (table === 'credentials') {
      let selectedService = '';
      const builder = {
        select: () => builder,
        eq: (field, value) => {
          if (field === 'service') selectedService = value;
          return builder;
        },
        single: async () => {
          credentialServices.push(selectedService);
          const encrypted_key = credentialByService[selectedService];
          return { data: encrypted_key ? { encrypted_key } : null };
        },
      };
      return builder;
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return { from, credentialServices };
}

describe('Meta canonical stack routing behavior', () => {
  it('normalizes all supported Page ID metadata shapes', () => {
    expect(api.metaIntegrationPageIds({
      pageId: ' 111 ',
      page_id: '222',
      pageIds: ['333', '111'],
      page_ids: ['444', ''],
    })).toEqual(['111', '222', '333', '444']);
  });

  it('selects the canonical integration, credential and app secret by incoming Page ID', async () => {
    const { from, credentialServices } = createAdminClient([
      { user_id: 'legacy-user', service: 'meta', metadata: { pageId: '111' } },
      { user_id: 'canonical-user', service: 'meta_ads', metadata: { pageIds: ['222', '333'], pixelId: '' } },
    ], { meta_ads: 'encrypted-canonical', meta: 'encrypted-legacy' });

    const decrypt = vi.spyOn(api.publicRouteHelpers, 'decryptCred').mockResolvedValue('canonical-token');
    const fetch = vi.spyOn(api.publicRouteHelpers, 'metaFetch').mockResolvedValue({
      id: 'lead-1',
      page_id: '333',
      field_data: [],
    });
    const persist = vi.spyOn(api.publicRouteHelpers, 'processLeadData').mockResolvedValue(null);

    await api.processMetaLeadChange({ from }, {
      field: 'leadgen',
      value: { leadgen_id: 'lead-1', page_id: '333' },
    });

    expect(credentialServices).toEqual(['meta_ads']);
    expect(decrypt).toHaveBeenCalledWith('encrypted-canonical');
    expect(fetch).toHaveBeenCalledWith(
      '/lead-1',
      expect.objectContaining({ fields: expect.stringContaining('field_data') }),
      'canonical-token',
      'canonical-secret',
    );
    expect(persist).toHaveBeenCalledWith(expect.anything(), 'canonical-user', expect.objectContaining({ id: 'lead-1' }));
  });

  it('keeps legacy Page routing on the legacy credential and secret', async () => {
    const { from, credentialServices } = createAdminClient([
      { user_id: 'legacy-user', service: 'meta', metadata: { page_id: '111', pixelId: '' } },
      { user_id: 'canonical-user', service: 'meta_ads', metadata: { pageId: '222' } },
    ], { meta: 'encrypted-legacy', meta_ads: 'encrypted-canonical' });

    vi.spyOn(api.publicRouteHelpers, 'decryptCred').mockResolvedValue('legacy-token');
    const fetch = vi.spyOn(api.publicRouteHelpers, 'metaFetch').mockResolvedValue({
      id: 'lead-2',
      page_id: '111',
      field_data: [],
    });
    vi.spyOn(api.publicRouteHelpers, 'processLeadData').mockResolvedValue(null);

    await api.processMetaLeadChange({ from }, {
      field: 'leadgen',
      value: { leadgen_id: 'lead-2', page_id: '111' },
    });

    expect(credentialServices).toEqual(['meta']);
    expect(fetch).toHaveBeenCalledWith(
      '/lead-2',
      expect.any(Object),
      'legacy-token',
      'legacy-secret',
    );
  });

  it('does not fall back across integrations when Page ID is unmatched', async () => {
    const { from, credentialServices } = createAdminClient([
      { user_id: 'legacy-user', service: 'meta', metadata: { pageId: '111' } },
      { user_id: 'canonical-user', service: 'meta_ads', metadata: { pageId: '222' } },
    ], { meta: 'encrypted-legacy', meta_ads: 'encrypted-canonical' });
    const fetch = vi.spyOn(api.publicRouteHelpers, 'metaFetch');

    await api.processMetaLeadChange({ from }, {
      field: 'leadgen',
      value: { leadgen_id: 'lead-3', page_id: '999' },
    });

    expect(credentialServices).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('verifies webhook HMAC against each configured secret independently', async () => {
    const body = JSON.stringify({ object: 'page', entry: [] });
    const canonicalSignature = `sha256=${createHmac('sha256', 'canonical-secret').update(body).digest('hex')}`;
    const legacySignature = `sha256=${createHmac('sha256', 'legacy-secret').update(body).digest('hex')}`;

    await expect(api.metaWebhookSignatureMatches(body, canonicalSignature, 'canonical-secret')).resolves.toBe(true);
    await expect(api.metaWebhookSignatureMatches(body, canonicalSignature, 'legacy-secret')).resolves.toBe(false);
    await expect(api.metaWebhookSignatureMatches(body, legacySignature, 'legacy-secret')).resolves.toBe(true);
  });
});
