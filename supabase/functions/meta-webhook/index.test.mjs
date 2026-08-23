import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('meta-webhook compatibility contract', () => {
  it('delegates all Meta webhook business logic to the canonical API handler', () => {
    expect(source).toContain("CANONICAL_META_WEBHOOK_PATH = '/functions/v1/api/webhooks/meta'");
    expect(source).toContain('await fetch(target');
    expect(source).not.toContain("createClient");
    expect(source).not.toContain(".from('users')");
    expect(source).not.toContain('META_ACCESS_TOKEN');
    expect(source).not.toContain('graph.facebook.com');
  });

  it('preserves the exact signed POST body and signature header', () => {
    expect(source).toContain("'x-hub-signature-256'");
    expect(source).toContain("request.method === 'POST' ? await request.arrayBuffer() : undefined");
    expect(source).toContain('body,');
  });

  it('forwards verification query parameters without forwarding caller credentials', () => {
    expect(source).toContain('target.search = incoming.search');
    expect(source).not.toMatch(/authorization|apikey|service_role/i);
  });

  it('fails closed on missing runtime configuration and unsupported methods', () => {
    expect(source).toContain("if (!SUPABASE_URL)");
    expect(source).toContain("status: 500");
    expect(source).toContain("['GET', 'POST', 'OPTIONS'].includes(request.method)");
    expect(source).toContain("status: 405");
  });
});
