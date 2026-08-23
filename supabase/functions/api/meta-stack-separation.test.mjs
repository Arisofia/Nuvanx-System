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
  const integrationQuery = { inCalls: [], eqCalls: [] };
  const from = vi.fn((table) => {
    if (table === 'integrations') {
      return {
        select: () => ({
          in: (field, values) => {
            integrationQuery.inCalls.push({ field, values });
            const serviceFiltered = field === 'service'
              ? integrations.filter((integration) => values.includes(integration.service))
              : [];
            return {
              eq: async (eqField, eqValue) => {
                integrationQuery.eqCalls.push({ field: eqField, value: eqValue });
                const data = eqField === 'status' && eqValue === 'connected'
                  ? serviceFiltered.filter((integration) => (integration.status ?? 'connected') === 'connected')
                  : [];
                return { data };
              },
            };
          },
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
  return { from, credentialServices, integrationQuery };
}

function webhookRequest(body, secret) {
  const rawBody = JSON.stringify(body);
  const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return new Request('https://example.test/api/webhooks/meta', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
    },
    body: rawBody,
  });
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

  it('queries connected legacy + canonical integrations and routes canonical Page correctly', async () => {
    const { from, credentialServices, integrationQuery } = createAdminClient([
      { user_id: 'legacy-user', service: 'meta', status: 'connected', metadata: { pageId: '111' } },
      { user_id: 'canonical-user', service: 'meta_ads', status: 'connected', metadata: { pageIds: ['222', '333'], pixelId: '' } },
      { user_id: 'ignored-user', service: 'meta_ads', status: 'disconnected', metadata: { pageId: '333' } },
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

    expect(integrationQuery.inCalls).toEqual([{ field: 'service', values: ['meta', 'meta_ads'] }]);
    expect(integrationQuery.eqCalls).toEqual([{ field: 'status', value: 'connected' }]);
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
      { user_id: 'legacy-user', service: 'meta', status: 'connected', metadata: { page_id: '111', pixelId: '' } },
      { user_id: 'canonical-user', service: 'meta_ads', status: 'connected', metadata: { pageId: '222' } },
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
    expect(fetch).toHaveBeenCalledWith('/lead-2', expect.any(Object), 'legacy-token', 'legacy-secret');
  });

  it('does not fall back across integrations when Page ID is unmatched', async () => {
    const { from, credentialServices } = createAdminClient([
      { user_id: 'legacy-user', service: 'meta', status: 'connected', metadata: { pageId: '111' } },
      { user_id: 'canonical-user', service: 'meta_ads', status: 'connected', metadata: { pageId: '222' } },
    ], { meta: 'encrypted-legacy', meta_ads: 'encrypted-canonical' });
    const fetch = vi.spyOn(api.publicRouteHelpers, 'metaFetch');

    await api.processMetaLeadChange({ from }, {
      field: 'leadgen',
      value: { leadgen_id: 'lead-3', page_id: '999' },
    });

    expect(credentialServices).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts both canonical- and legacy-signed requests through the webhook handler', async () => {
    vi.spyOn(api.supabaseClientFactory, 'create').mockReturnValue({ from: vi.fn() });
    const payload = { object: 'page', entry: [] };

    const canonicalResponse = await api.handleMetaWebhookPost({ req: webhookRequest(payload, 'canonical-secret') });
    const legacyResponse = await api.handleMetaWebhookPost({ req: webhookRequest(payload, 'legacy-secret') });
    const invalidResponse = await api.handleMetaWebhookPost({ req: webhookRequest(payload, 'wrong-secret') });

    expect(canonicalResponse.status).toBe(200);
    expect(legacyResponse.status).toBe(200);
    expect(invalidResponse.status).toBe(403);
  });
});
