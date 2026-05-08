import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const originalFetch = globalThis.fetch;
const originalDenoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno');

if (!originalDenoDescriptor) {
  Object.defineProperty(globalThis, 'Deno', {
    configurable: true,
    enumerable: true,
    value: {
      env: { get: vi.fn().mockReturnValue(undefined) },
      serve: vi.fn(),
    },
  });
} else if (!(globalThis as any).Deno?.serve) {
  Object.defineProperty(globalThis, 'Deno', {
    configurable: true,
    enumerable: true,
    get() {
      const base = originalDenoDescriptor.get ? originalDenoDescriptor.get.call(globalThis) : originalDenoDescriptor.value;
      const denoStub = base ? { ...base } : {};
      denoStub.serve = vi.fn();
      return denoStub;
    },
  });
}

const api = await import('./index.ts');
const {
  normalizeFrontendUrl,
  buildCorsHeaders,
  ALLOWED_CORS_ORIGINS,
  DEFAULT_CORS_ORIGIN,
  DEFAULT_CORS_HEADERS,
  hexToBytes,
  bytesToHex,
  decryptCred,
  handlePublicRoutes,
  processLeadData,
  createClient,
  createSupabaseClient,
  META_GRAPH,
  metaFetch,
  parseJsonOrText,
  parseMetaMetric,
  extractMetaAccountRawValue,
  actionValue,
  buildCampaignsTimeRange,
  calculateVerifiedRevenueInRange,
} = api;

describe('calculateVerifiedRevenueInRange', () => {
  const patientFirstSettlement = {
    patient_a: '2026-05-03T10:00:00Z',
    patient_b: '2026-04-28T10:00:00Z',
  };

  it('sums all valid in-range Doctoralia settlements while counting only attributed unique patients', () => {
    const result = calculateVerifiedRevenueInRange(patientFirstSettlement, [
      { patient_id: 'patient_a', dni_hash: null, amount_net: 100, settled_at: '2026-05-03T10:00:00Z', source_system: 'doctoralia', cancelled_at: null },
      { patient_id: null, dni_hash: null, amount_net: 200, settled_at: '2026-05-04T10:00:00Z', source_system: 'doctoralia', cancelled_at: null },
      { patient_id: 'patient_b', dni_hash: null, amount_net: 300, settled_at: '2026-04-28T10:00:00Z', source_system: 'doctoralia', cancelled_at: null },
      { patient_id: 'patient_c', dni_hash: null, amount_net: 400, settled_at: '2026-05-05T10:00:00Z', source_system: 'doctoralia', cancelled_at: '2026-05-06T10:00:00Z' },
      { patient_id: 'patient_d', dni_hash: null, amount_net: 500, settled_at: '2026-05-05T10:00:00Z', source_system: 'manual', cancelled_at: null },
      { patient_id: 'patient_e', dni_hash: null, amount_net: 0, settled_at: '2026-05-05T10:00:00Z', source_system: 'doctoralia', cancelled_at: null },
    ], '2026-05-01', '2026-05-31');

    expect(result.verifiedRevenue).toBe(300);
    expect(result.verifiedPatientIds).toEqual(new Set(['patient_a']));
    expect(result.settlementsInRange).toHaveLength(2);
    expect(result.settlementsAttributed).toBe(1);
    expect(result.settlementsUnattributed).toBe(1);
    expect(result.attributionStatus).toBe('partial');
  });

  it('marks low attribution when revenue exists but no settlement has patient identifiers', () => {
    const result = calculateVerifiedRevenueInRange({}, [
      { patient_id: null, dni_hash: null, amount_net: 125, settled_at: '2026-05-07T10:00:00Z', source_system: 'doctoralia', cancelled_at: null },
    ], '2026-05-01', '2026-05-31');

    expect(result.verifiedRevenue).toBe(125);
    expect(result.verifiedPatientIds.size).toBe(0);
    expect(result.settlementsAttributed).toBe(0);
    expect(result.settlementsUnattributed).toBe(1);
    expect(result.attributionStatus).toBe('low_attribution');
  });
});

describe('normalizeFrontendUrl', () => {
  it('returns null when url is empty string', () => {
    expect(normalizeFrontendUrl('')).toBeNull();
  });

  it('returns null when url is the wildcard "*"', () => {
    expect(normalizeFrontendUrl('*')).toBeNull();
  });

  it('returns null when url equals "null" regardless of case', () => {
    expect(normalizeFrontendUrl('null')).toBeNull();
    expect(normalizeFrontendUrl('NULL')).toBeNull();
    expect(normalizeFrontendUrl('NuLl')).toBeNull();
  });

  it('returns null when url is not a valid URL', () => {
    expect(normalizeFrontendUrl('not-a-url')).toBeNull();
  });

  it('returns null for unsupported protocols', () => {
    ['http://example.com', 'HTTP://example.com', 'ftp://example.com', 'wss://example.com'].forEach((input) => {
      expect(normalizeFrontendUrl(input)).toBeNull();
    });
  });

  it('returns a normalized https URL without trailing slash', () => {
    expect(normalizeFrontendUrl('https://example.com/')).toBe('https://example.com');
  });

  it('preserves path and query string while removing only the final trailing slash', () => {
    const result = normalizeFrontendUrl('https://example.com/foo/bar/?q=1');
    expect(result).toBeTruthy();
    expect(result?.startsWith('https://example.com/foo/bar')).toBe(true);
    expect(result?.endsWith('/')).toBe(false);
  });

  it('does not remove internal path slashes', () => {
    expect(normalizeFrontendUrl('https://example.com/foo/bar')).toBe('https://example.com/foo/bar');
  });

  it('handles mixed-case https protocol and normalizes via URL', () => {
    expect(normalizeFrontendUrl('HtTpS://Example.com/')).toBe('https://example.com');
  });
});

describe('buildCorsHeaders', () => {
  let originalProcessDescriptor: PropertyDescriptor | undefined;
  let originalDenoDescriptorLocal: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
    originalDenoDescriptorLocal = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
    vi.spyOn(globalThis, 'process', 'get').mockReturnValue({ env: {} } as any);
    vi.spyOn(globalThis as any, 'Deno', 'get').mockReturnValue(undefined as any);
    ALLOWED_CORS_ORIGINS.clear();
    ALLOWED_CORS_ORIGINS.add('https://app.example.com');
    ALLOWED_CORS_ORIGINS.add('https://dashboard.example.com');
    ALLOWED_CORS_ORIGINS.add('https://other.example.com');
    ALLOWED_CORS_ORIGINS.add('https://case-sensitive.example.com');
    // Keep the existing DEFAULT_CORS_ORIGIN constant value as a fallback.
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalProcessDescriptor) {
      Object.defineProperty(globalThis, 'process', originalProcessDescriptor);
    }
    if (originalDenoDescriptorLocal) {
      Object.defineProperty(globalThis, 'Deno', originalDenoDescriptorLocal);
    }
  });

  it('returns headers with Access-Control-Allow-Origin set to origin when it is allowed', () => {
    const origin = 'https://app.example.com';
    const headers = buildCorsHeaders(origin);
    expect(headers['Access-Control-Allow-Origin']).toBe(origin);
    expect(headers['Access-Control-Allow-Methods']).toBe(DEFAULT_CORS_HEADERS['Access-Control-Allow-Methods']);
    expect(headers['Access-Control-Allow-Headers']).toBe(DEFAULT_CORS_HEADERS['Access-Control-Allow-Headers']);
  });

  it('returns headers with default origin when origin is null', () => {
    expect(buildCorsHeaders(null)['Access-Control-Allow-Origin']).toBe(DEFAULT_CORS_ORIGIN);
  });

  it('falls back to default origin when origin is an empty string', () => {
    expect(buildCorsHeaders('')['Access-Control-Allow-Origin']).toBe(DEFAULT_CORS_ORIGIN);
  });

  it('falls back to default origin when origin is not in ALLOWED_CORS_ORIGINS', () => {
    expect(buildCorsHeaders('https://not-allowed.example.com')['Access-Control-Allow-Origin']).toBe(DEFAULT_CORS_ORIGIN);
  });

  it('treats allowed origins as case-sensitive by default', () => {
    const originLower = 'https://case-sensitive.example.com';
    const originUpper = 'https://CASE-SENSITIVE.example.com';
    expect(buildCorsHeaders(originLower)['Access-Control-Allow-Origin']).toBe(originLower);
    expect(buildCorsHeaders(originUpper)['Access-Control-Allow-Origin']).toBe(DEFAULT_CORS_ORIGIN);
  });

  it('does not mutate DEFAULT_CORS_HEADERS when building headers', () => {
    const origin = 'https://dashboard.example.com';
    const headers1 = buildCorsHeaders(origin);
    const headers2 = buildCorsHeaders(origin);
    headers1['Access-Control-Allow-Methods'] = 'DELETE';
    expect(DEFAULT_CORS_HEADERS['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS');
    expect(headers2['Access-Control-Allow-Methods']).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS');
  });
});

describe('hexToBytes', () => {
  it('converts an even-length hex string to the corresponding byte array', () => {
    const bytes = hexToBytes('0a1b2c3d4e5f');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([0x0a, 0x1b, 0x2c, 0x3d, 0x4e, 0x5f]);
  });

  it('handles lowercase and uppercase hex characters equivalently', () => {
    expect(Array.from(hexToBytes('deadbeef'))).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(Array.from(hexToBytes('DEADBEEF'))).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('returns an empty Uint8Array when given an empty string', () => {
    const bytes = hexToBytes('');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(0);
  });

  it('allocates array length as hex.length >>> 1 and uses i >>> 1 for index', () => {
    const bytes = hexToBytes('00112233');
    expect(bytes.length).toBe(4);
    expect(Array.from(bytes)).toEqual([0x00, 0x11, 0x22, 0x33]);
  });

  it('parses odd-length hex by ignoring the final nibble', () => {
    const bytes = hexToBytes('abc');
    expect(bytes.length).toBe(1);
    expect(bytes[0]).toBe(0xab);
  });

  it('propagates NaN behavior when hex contains non-hex characters', () => {
    const bytes = hexToBytes('zz');
    expect(bytes.length).toBe(1);
    expect(bytes[0]).toBe(0);
  });
});

describe('bytesToHex', () => {
  it('converts a typical Uint8Array to a lowercase hex string', () => {
    const result = bytesToHex(new Uint8Array([0x00, 0x1a, 0x2b, 0xff]));
    expect(result).toBe('001a2bff');
  });

  it('returns an empty string for an empty Uint8Array', () => {
    const result = bytesToHex(new Uint8Array([]));
    expect(result).toBe('');
  });

  it('pads single-nibble values with leading zero', () => {
    const result = bytesToHex(new Uint8Array([0x0, 0x1, 0x9]));
    expect(result).toBe('000109');
  });

  it('handles full byte range and concatenates correctly', () => {
    const result = bytesToHex(new Uint8Array([0x00, 0x7f, 0x80, 0xff]));
    expect(result).toBe('007f80ff');
  });

  it('accepts Uint8Array subclasses and serializes them correctly', () => {
    class CustomUint8Array extends Uint8Array {}
    const result = bytesToHex(new CustomUint8Array([0x0f, 0x10]));
    expect(result).toBe('0f10');
  });
});

describe('custom Deno getter stub', () => {
  let originalDescriptor: PropertyDescriptor | undefined;

  const buildDenoGetter = (descriptor: PropertyDescriptor) => {
    return () => {
      const originalValue = descriptor.get
        ? descriptor.get.call(globalThis)
        : descriptor.value;
      const res = originalValue ? { ...originalValue } : {};
      res.serve = vi.fn();
      return res;
    };
  };

  beforeEach(() => {
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
  });

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'Deno', originalDescriptor);
    } else {
      delete (globalThis as any).Deno;
    }
    vi.restoreAllMocks();
  });

  it('merges result of original get() with a new serve mock (happy path with getter)', () => {
    const originalGet = vi.fn().mockReturnValue({ foo: 'bar', serve: 'should-be-overwritten' });
    Object.defineProperty(globalThis, 'Deno', {
      configurable: true,
      get: originalGet,
    });

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
    if (!descriptor) throw new Error('Deno descriptor missing');
    const getterUnderTest = buildDenoGetter(descriptor);

    const result = getterUnderTest();

    expect(originalGet).toHaveBeenCalledTimes(1);
    expect(result.foo).toBe('bar');
    expect(typeof result.serve).toBe('function');
    expect(result.serve).not.toBe('should-be-overwritten');

    const result2 = getterUnderTest();
    expect(result.serve).not.toBe(result2.serve);
  });

  it('merges original value with a new serve mock when descriptor has value but no get (happy path with value)', () => {
    Object.defineProperty(globalThis, 'Deno', {
      configurable: true,
      value: { hello: 'world' },
    });

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
    if (!descriptor) throw new Error('Deno descriptor missing');
    const getterUnderTest = buildDenoGetter(descriptor);

    const result = getterUnderTest();

    expect(result.hello).toBe('world');
    expect(typeof result.serve).toBe('function');
  });

  it('handles descriptor with neither get nor value, returning an object with only serve (edge case)', () => {
    Object.defineProperty(globalThis, 'Deno', {
      configurable: true,
      value: undefined,
    });

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
    if (!descriptor) throw new Error('Deno descriptor missing');
    const getterUnderTest = buildDenoGetter(descriptor);

    const result = getterUnderTest();

    expect(Object.keys(result)).toEqual(['serve']);
    expect(typeof result.serve).toBe('function');
  });

  it('treats null or undefined from original getter/value as empty object (edge value cases)', () => {
    const originalGet = vi.fn().mockReturnValue(null);
    Object.defineProperty(globalThis, 'Deno', {
      configurable: true,
      get: originalGet,
    });

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
    if (!descriptor) throw new Error('Deno descriptor missing');
    const getterUnderTest = buildDenoGetter(descriptor);

    const result = getterUnderTest();

    expect(originalGet).toHaveBeenCalledTimes(1);
    expect(Object.keys(result)).toEqual(['serve']);
    expect(typeof result.serve).toBe('function');
  });

  it('ensures serve is a fresh vi.fn for each getter call (branch)', () => {
    Object.defineProperty(globalThis, 'Deno', {
      configurable: true,
      value: { foo: 'bar' },
    });

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
    if (!descriptor) throw new Error('Deno descriptor missing');
    const getterUnderTest = buildDenoGetter(descriptor);

    const first = getterUnderTest();
    const second = getterUnderTest();

    expect(first.foo).toBe('bar');
    expect(second.foo).toBe('bar');
    expect(first.serve).not.toBe(second.serve);
    expect(typeof first.serve).toBe('function');
    expect(typeof second.serve).toBe('function');
  });
});

describe('decryptCred', () => {
  let denoDescriptor: PropertyDescriptor | undefined;
  let cryptoDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    denoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
    cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    vi.spyOn(globalThis as any, 'Deno', 'get').mockReturnValue({ env: { get: vi.fn() } } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (denoDescriptor) Object.defineProperty(globalThis, 'Deno', denoDescriptor);
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  });

  it('throws when ENCRYPTION_KEY is not set', async () => {
    const deno = (globalThis as any).Deno;
    deno.env.get.mockReturnValue(undefined);
    await expect(() => decryptCred('aa:bb:cc:dd')).rejects.toThrow('ENCRYPTION_KEY not set in Edge Function secrets');
    expect(deno.env.get).toHaveBeenCalledWith('ENCRYPTION_KEY');
  });

  it('throws for malformed ciphertext strings that do not have 4 parts', async () => {
    const deno = (globalThis as any).Deno;
    deno.env.get.mockReturnValue('dummy-key');
    for (const encoded of ['one-part', 'a:b:c', 'a:b:c:d:e']) {
      await expect(() => decryptCred(encoded as any)).rejects.toThrow('malformed ciphertext');
    }
  });

  it('concatenates ciphertext and tag and calls Web Crypto APIs correctly', async () => {
    const deno = (globalThis as any).Deno;
    deno.env.get.mockReturnValue('test-master-key');

    const saltH = 'aa';
    const ivH = 'bb';
    const tagH = 'ccdd';
    const ctH = '0102';
    const encoded = `${saltH}:${ivH}:${tagH}:${ctH}`;

    vi.spyOn(globalThis.crypto.subtle, 'importKey').mockResolvedValue('km-object' as any);
    vi.spyOn(globalThis.crypto.subtle, 'deriveKey').mockResolvedValue('aes-key-object' as any);
    vi.spyOn(globalThis.crypto.subtle, 'decrypt').mockResolvedValue(new TextEncoder().encode('decrypted-value') as any);

    const result = await decryptCred(encoded);

    expect(deno.env.get).toHaveBeenCalledWith('ENCRYPTION_KEY');
    expect(globalThis.crypto.subtle.importKey).toHaveBeenCalledWith(
      'raw',
      new TextEncoder().encode('test-master-key'),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const deriveCall = (globalThis.crypto.subtle.deriveKey as any).mock.calls[0];
    expect(deriveCall[0]).toMatchObject({ name: 'PBKDF2', iterations: 100_000, hash: 'SHA-256' });
    expect(deriveCall[2]).toMatchObject({ name: 'AES-GCM', length: 256 });

    expect(globalThis.crypto.subtle.decrypt).toHaveBeenCalledTimes(1);
    expect(result).toBe('decrypted-value');
  });

  it('propagates errors thrown by crypto.subtle.decrypt', async () => {
    const deno = (globalThis as any).Deno;
    deno.env.get.mockReturnValue('test-master-key');
    vi.spyOn(api, 'hexToBytes').mockImplementation((hex: string) => {
      const arr = new Uint8Array(hex.length >>> 1);
      for (let i = 0; i < arr.length; i++) arr[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return arr;
    });
    vi.spyOn(globalThis.crypto.subtle, 'importKey').mockResolvedValue('km-object' as any);
    vi.spyOn(globalThis.crypto.subtle, 'deriveKey').mockResolvedValue('aes-key-object' as any);
    vi.spyOn(globalThis.crypto.subtle, 'decrypt').mockRejectedValue(new Error('Decrypt failed'));

    await expect(() => decryptCred('aa:bb:ccdd:0102')).rejects.toThrow('Decrypt failed');
  });
});

const makeCtx = (partial: Partial<{ req: Request; url: URL; resource: string; sub: string | null; sendJson: (body: any) => Response; }>): any => {
  const url = partial.url ?? new URL('https://example.com/');
  return {
    req: partial.req ?? new Request(url.toString()),
    url,
    resource: partial.resource ?? '',
    sub: partial.sub ?? null,
    sendJson: partial.sendJson ?? ((body: any) => new Response(JSON.stringify(body), { status: 200 })),
  };
};

describe('handlePublicRoutes', () => {
  let originalDenoDescriptorLocal: PropertyDescriptor | undefined;
  let originalCryptoDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalDenoDescriptorLocal = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
    originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    vi.spyOn(globalThis as any, 'Deno', 'get').mockReturnValue({ env: { get: vi.fn() } } as any);
  });

  afterEach(() => {
    if (originalDenoDescriptorLocal) {
      Object.defineProperty(globalThis, 'Deno', originalDenoDescriptorLocal);
    }
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    }
    vi.restoreAllMocks();
  });

  describe('META webhooks GET verification', () => {
    it('returns 503 when verify token env is not configured', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockReturnValue(undefined);

      const url = new URL(
        'https://example.com/webhooks/meta?hub.mode=subscribe&hub.challenge=123&hub.verify_token=token',
      );
      const ctx = makeCtx({
        resource: 'webhooks',
        sub: 'meta',
        req: new Request(url.toString(), { method: 'GET' }),
        url,
      });

      const res = await handlePublicRoutes(ctx);

      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toBe('Verify token not configured');
    });

    it('returns 200 with challenge when mode=subscribe and verify token matches expected', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet
        .mockImplementationOnce((key: string) => (key === 'META_WEBHOOK_VERIFY_TOKEN' ? 'expected-token' : null))
        .mockImplementation((key: string) => (key === 'META_VERIFY_TOKEN' ? 'expected-token-2' : null));

      const url = new URL(
        'https://example.com/webhooks/meta?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=expected-token',
      );
      const ctx = makeCtx({
        resource: 'webhooks',
        sub: 'meta',
        req: new Request(url.toString(), { method: 'GET' }),
        url,
      });

      const res = await handlePublicRoutes(ctx);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/plain');
      expect(await res.text()).toBe('abc123');
    });

    it('returns 403 when mode/verify token combination is incorrect', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) =>
        key === 'META_WEBHOOK_VERIFY_TOKEN' ? 'expected-token' : null,
      );

      const url = new URL(
        'https://example.com/webhooks/meta?hub.mode=invalid&hub.challenge=abc123&hub.verify_token=wrong',
      );
      const ctx = makeCtx({
        resource: 'webhooks',
        sub: 'meta',
        req: new Request(url.toString(), { method: 'GET' }),
        url,
      });

      const res = await handlePublicRoutes(ctx);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe('Forbidden');
    });
  });

  describe('META webhooks POST', () => {
    it('returns Unauthorized when appSecret is set and signature does not match (HMAC check error)', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => {
        if (key === 'META_APP_SECRET') return 'test-secret';
        return null;
      });

      const importKeyMock = vi.fn().mockResolvedValue('key');
      const signMock = vi.fn().mockResolvedValue(new Uint8Array([0x01, 0x02]).buffer);
      vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue({
        subtle: {
          importKey: importKeyMock,
          sign: signMock,
        },
      } as any);

      const body = JSON.stringify({ foo: 'bar' });
      const req = new Request('https://example.com/webhooks/meta', {
        method: 'POST',
        body,
        headers: {
          'X-Hub-Signature-256': 'sha256=deadbeef',
        },
      });
      const ctx = makeCtx({ resource: 'webhooks', sub: 'meta', req });

      const res = await handlePublicRoutes(ctx);

      expect(res.status).toBe(403);
      expect(await res.text()).toBe('Unauthorized');
    });

    it('skips signature validation when META_APP_SECRET is not set (edge)', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => {
        if (key === 'SUPABASE_URL') return 'https://supabase.example.com';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-key';
        return null;
      });

      const body = '{"object": "page", "entry": []}';
      const req = new Request('https://example.com/webhooks/meta', {
        method: 'POST',
        body,
      });
      const ctx = makeCtx({ resource: 'webhooks', sub: 'meta', req });

      const res = await handlePublicRoutes(ctx);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
    });

    it('returns ok when JSON parse fails (invalid JSON)', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => null);

      const req = new Request('https://example.com/webhooks/meta', {
        method: 'POST',
        body: 'not-json',
      });
      const ctx = makeCtx({ resource: 'webhooks', sub: 'meta', req });

      const res = await handlePublicRoutes(ctx);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
    });

    it('returns ok when payload.object is not "page"', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => null);

      const body = JSON.stringify({ object: 'other' });
      const req = new Request('https://example.com/webhooks/meta', {
        method: 'POST',
        body,
      });
      const ctx = makeCtx({ resource: 'webhooks', sub: 'meta', req });

      const res = await handlePublicRoutes(ctx);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
    });

    it('processes leadgen change with matching integration and calls processLeadData (happy path)', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => {
        if (key === 'META_APP_SECRET') return null;
        if (key === 'SUPABASE_URL') return 'https://supabase.example.com';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-key';
        return null;
      });

      const integrationsQuery = {
        data: [{ user_id: 'user1', metadata: { pageId: 'PAGE_ID' } }],
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };

      const credentialsQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { encrypted_key: 'enc-key' } }),
      };

      const adminClient = {
        from: vi.fn((table: string) => (table === 'integrations' ? integrationsQuery : credentialsQuery)),
      };

      const createClientMock = vi.spyOn(api.supabaseClientFactory, 'create').mockReturnValue(adminClient as any);
      const decryptCredMock = vi.spyOn(api.publicRouteHelpers, 'decryptCred').mockResolvedValue('access-token');
      const metaFetchMock = vi.spyOn(api.publicRouteHelpers, 'metaFetch').mockResolvedValue({ some: 'lead' } as any);
      const processLeadDataMock = vi.spyOn(api.publicRouteHelpers, 'processLeadData').mockResolvedValue(undefined);

      const body = JSON.stringify({
        object: 'page',
        entry: [
          {
            changes: [
              {
                field: 'leadgen',
                value: {
                  leadgen_id: 'LEAD_ID',
                  page_id: 'PAGE_ID',
                },
              },
            ],
          },
        ],
      });
      const req = new Request('https://example.com/webhooks/meta', {
        method: 'POST',
        body,
      });
      const ctx = makeCtx({ resource: 'webhooks', sub: 'meta', req });

      const res = await handlePublicRoutes(ctx);

      expect(createClientMock).toHaveBeenCalled();
      expect(adminClient.from).toHaveBeenCalledWith('integrations');
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
      expect(decryptCredMock).toHaveBeenCalledWith('enc-key');
      expect(metaFetchMock).toHaveBeenCalledWith(
        '/LEAD_ID',
        {
          fields: 'field_data,created_time,ad_id,ad_name,form_id,form_name,campaign_id,campaign_name,adset_id,adset_name,page_id,is_organic,platform',
        },
        'access-token',
      );
      expect(processLeadDataMock).toHaveBeenCalledWith(adminClient, 'user1', { some: 'lead' });
    });

    it('skips processing when no matching integration is found (edge: no integration)', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => {
        if (key === 'META_APP_SECRET') return null;
        if (key === 'SUPABASE_URL') return 'https://supabase.example.com';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-key';
        return null;
      });

      const integrationsQuery = {
        data: [],
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      const adminClient = {
        from: vi.fn(() => integrationsQuery),
      };
      vi.spyOn(api.supabaseClientFactory, 'create').mockReturnValue(adminClient as any);
      const decryptCredMock = vi.spyOn(api, 'decryptCred').mockResolvedValue('token');
      const metaFetchMock = vi.spyOn(api, 'metaFetch').mockResolvedValue({} as any);
      const processLeadDataMock = vi.spyOn(api, 'processLeadData').mockResolvedValue(undefined);

      const body = JSON.stringify({
        object: 'page',
        entry: [
          { changes: [{ field: 'leadgen', value: { leadgen_id: 'LEAD', page_id: 'PAGE' } }] },
        ],
      });
      const req = new Request('https://example.com/webhooks/meta', { method: 'POST', body });
      const ctx = makeCtx({ resource: 'webhooks', sub: 'meta', req });

      const res = await handlePublicRoutes(ctx);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
      expect(decryptCredMock).not.toHaveBeenCalled();
      expect(metaFetchMock).not.toHaveBeenCalled();
      expect(processLeadDataMock).not.toHaveBeenCalled();
    });
  });

  describe('WhatsApp webhooks GET verification', () => {
    it('returns 503 when verify token env is not configured', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockReturnValue(undefined);

      const url = new URL(
        'https://example.com/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=123&hub.verify_token=token',
      );
      const ctx = makeCtx({
        resource: 'webhooks',
        sub: 'whatsapp',
        req: new Request(url.toString(), { method: 'GET' }),
        url,
      });

      const res = await handlePublicRoutes(ctx);

      expect(res.status).toBe(503);
      expect(await res.text()).toBe('Verify token not configured');
    });

    it('returns 200 with challenge when mode=subscribe and verify token matches expected', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet
        .mockImplementationOnce((key: string) => (key === 'WHATSAPP_WEBHOOK_VERIFY_TOKEN' ? 'expected-token' : null))
        .mockImplementation((key: string) => (key === 'META_WEBHOOK_VERIFY_TOKEN' ? 'fallback-token' : null));

      const url = new URL(
        'https://example.com/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=expected-token',
      );
      const ctx = makeCtx({
        resource: 'webhooks',
        sub: 'whatsapp',
        req: new Request(url.toString(), { method: 'GET' }),
        url,
      });

      const res = await handlePublicRoutes(ctx);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/plain');
      expect(await res.text()).toBe('abc123');
    });

    it('falls back to META webhook verify token when WHATSAPP token is not set', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => (key === 'META_WEBHOOK_VERIFY_TOKEN' ? 'fallback-token' : null));

      const url = new URL(
        'https://example.com/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=fallback-token',
      );
      const ctx = makeCtx({
        resource: 'webhooks',
        sub: 'whatsapp',
        req: new Request(url.toString(), { method: 'GET' }),
        url,
      });

      const res = await handlePublicRoutes(ctx);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('abc123');
    });

    it('returns 403 when mode/verify token combination is incorrect', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => (key === 'WHATSAPP_WEBHOOK_VERIFY_TOKEN' ? 'expected-token' : null));

      const url = new URL(
        'https://example.com/webhooks/whatsapp?hub.mode=invalid&hub.challenge=abc123&hub.verify_token=wrong',
      );
      const ctx = makeCtx({
        resource: 'webhooks',
        sub: 'whatsapp',
        req: new Request(url.toString(), { method: 'GET' }),
        url,
      });

      const res = await handlePublicRoutes(ctx);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe('Forbidden');
    });
  });

  describe('WhatsApp webhooks POST', () => {
    it('returns Unauthorized when appSecret is set and signature does not match', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => {
        if (key === 'META_APP_SECRET') return 'test-secret';
        return null;
      });

      const importKeyMock = vi.fn().mockResolvedValue('key');
      const signMock = vi.fn().mockResolvedValue(new Uint8Array([0x01, 0x02]).buffer);
      vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue({
        subtle: {
          importKey: importKeyMock,
          sign: signMock,
        },
      } as any);

      const body = JSON.stringify({ foo: 'bar' });
      const req = new Request('https://example.com/webhooks/whatsapp', {
        method: 'POST',
        body,
        headers: {
          'X-Hub-Signature-256': 'sha256=deadbeef',
        },
      });
      const ctx = makeCtx({ resource: 'webhooks', sub: 'whatsapp', req });

      const res = await handlePublicRoutes(ctx);

      expect(res.status).toBe(403);
      expect(await res.text()).toBe('Unauthorized');
    });

    it('returns ok when JSON parse fails (invalid JSON)', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => null);

      const req = new Request('https://example.com/webhooks/whatsapp', {
        method: 'POST',
        body: 'not-json',
      });
      const ctx = makeCtx({ resource: 'webhooks', sub: 'whatsapp', req });

      const res = await handlePublicRoutes(ctx);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
    });

    it('processes a valid WhatsApp inbound message and creates a lead record', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => {
        if (key === 'META_APP_SECRET') return null;
        if (key === 'SUPABASE_URL') return 'https://supabase.example.com';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-key';
        if (key === 'DEFAULT_PHONE_COUNTRY_CODE') return '34';
        return null;
      });

      const integrationsQuery = {
        data: [{ user_id: 'user1', metadata: { phone_number_id: '123' } }],
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      const leadsQuery = {
        upsert: vi.fn(function () { return this; }),
        select: vi.fn(function () { return this; }),
        update: vi.fn(function () { return this; }),
        eq: vi.fn(function () { return this; }),
        or: vi.fn(function () { return this; }),
        is: vi.fn(function () { return this; }),
        order: vi.fn(function () { return this; }),
        limit: vi.fn(function () { return this; }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'lead1' } }),
      };
      const usersQuery = {
        select: vi.fn(function () { return this; }),
        eq: vi.fn(function () { return this; }),
        single: vi.fn().mockResolvedValue({ data: { clinic_id: 'clinic1' } }),
      };
      const whatsappQuery = {
        insert: vi.fn().mockResolvedValue({ data: [{ id: 'conv1' }] }),
      };
      const adminClient = {
        from: vi.fn((table: string) => {
          if (table === 'integrations') return integrationsQuery;
          if (table === 'users') return usersQuery;
          if (table === 'whatsapp_conversations') return whatsappQuery;
          return leadsQuery;
        }),
      };

      const createClientMock = vi.spyOn(api.supabaseClientFactory, 'create').mockReturnValue(adminClient as any);

      const body = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '123' },
                  contacts: [{ wa_id: '34612345678', profile: { name: 'Alice' } }],
                  messages: [{ id: 'msg1', from: '34612345678', timestamp: '1690000000', text: { body: 'Hello' } }],
                },
              },
            ],
          },
        ],
      });
      const req = new Request('https://example.com/webhooks/whatsapp', {
        method: 'POST',
        body,
      });
      const ctx = makeCtx({ resource: 'webhooks', sub: 'whatsapp', req });

      const res = await handlePublicRoutes(ctx);

      expect(createClientMock).toHaveBeenCalled();
      expect(adminClient.from).toHaveBeenCalledWith('integrations');
      expect(leadsQuery.update).toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
    });

    it('creates a whatsapp_conversation row and updates a matched lead stage when inbound WA message arrives', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => {
        if (key === 'META_APP_SECRET') return null;
        if (key === 'SUPABASE_URL') return 'https://supabase.example.com';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-key';
        if (key === 'DEFAULT_PHONE_COUNTRY_CODE') return '34';
        return null;
      });

      const integrationsQuery = {
        data: [{ user_id: 'user1', metadata: { phone_number_id: '123' } }],
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
      const leadsQuery = {
        upsert: vi.fn(function () { return this; }),
        select: vi.fn(function () { return this; }),
        update: vi.fn(function () { return this; }),
        eq: vi.fn(function () { return this; }),
        or: vi.fn(function () { return this; }),
        is: vi.fn(function () { return this; }),
        order: vi.fn(function () { return this; }),
        limit: vi.fn(function () { return this; }),
        ilike: vi.fn(function () { return this; }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'lead1', stage: 'lead' } }),
      };
      const whatsappQuery = {
        insert: vi.fn().mockResolvedValue({ data: [{ id: 'conv1' }] }),
      };
      const usersQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { clinic_id: 'clinic1' } }),
      };

      const adminClient = {
        from: vi.fn((table: string) => {
          if (table === 'integrations') return integrationsQuery;
          if (table === 'leads') return leadsQuery;
          if (table === 'whatsapp_conversations') return whatsappQuery;
          if (table === 'users') return usersQuery;
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null }) };
        }),
      };
      const createClientMock = vi.spyOn(api.supabaseClientFactory, 'create').mockReturnValue(adminClient as any);

      const body = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '123' },
                  contacts: [{ wa_id: '34612345678', profile: { name: 'Alice' } }],
                  messages: [{ id: 'msg1', from: '34612345678', timestamp: '1690000000', text: { body: 'Hello' } }],
                },
              },
            ],
          },
        ],
      });
      const req = new Request('https://example.com/webhooks/whatsapp', {
        method: 'POST',
        body,
      });
      const ctx = makeCtx({ resource: 'webhooks', sub: 'whatsapp', req });

      const res = await handlePublicRoutes(ctx);

      expect(createClientMock).toHaveBeenCalled();
      expect(adminClient.from).toHaveBeenCalledWith('integrations');
      expect(leadsQuery.update).toHaveBeenCalled();
      expect(whatsappQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
        clinic_id: 'clinic1',
        direction: 'inbound',
        message_type: 'text',
      }));
      expect(res.status).toBe(200);
    });
  });

  describe('health/secrets endpoint', () => {
    it('returns success=false and status=missing when required secrets are missing (edge)', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => {
        if (key === 'ENCRYPTION_KEY') return '';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return '   ';
        return null;
      });
      const sendJson = vi.fn((body: any) => new Response(JSON.stringify(body), { status: 200 }));
      const req = new Request('https://example.com/health/secrets', { method: 'GET' });
      const url = new URL(req.url);
      const ctx = makeCtx({ resource: 'health', sub: 'secrets', req, url, sendJson });

      const res = await handlePublicRoutes(ctx);
      const payload = JSON.parse(await res.text());

      expect(sendJson).toHaveBeenCalledTimes(1);
      expect(payload.success).toBe(false);
      expect(payload.status).toBe('missing');
      expect(payload.required).toEqual({
        ENCRYPTION_KEY: false,
        SUPABASE_SERVICE_ROLE_KEY: false,
      });
    });

    it('returns success=true and status=ok when both secrets are present (happy path)', async () => {
      const envGet = (globalThis as any).Deno.env.get as ReturnType<typeof vi.fn>;
      envGet.mockImplementation((key: string) => {
        if (key === 'ENCRYPTION_KEY') return 'some-key';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-key';
        return null;
      });
      const sendJson = vi.fn((body: any) => new Response(JSON.stringify(body), { status: 200 }));
      const req = new Request('https://example.com/health/secrets', { method: 'GET' });
      const url = new URL(req.url);
      const ctx = makeCtx({ resource: 'health', sub: 'secrets', req, url, sendJson });

      const res = await handlePublicRoutes(ctx);
      const payload = JSON.parse(await res.text());

      expect(payload.success).toBe(true);
      expect(payload.status).toBe('ok');
      expect(payload.required).toEqual({
        ENCRYPTION_KEY: true,
        SUPABASE_SERVICE_ROLE_KEY: true,
      });
    });
  });

  describe('health endpoint', () => {
    it('returns basic health status with timestamp (happy path)', async () => {
      const sendJson = vi.fn((body: any) => new Response(JSON.stringify(body), { status: 200 }));
      const req = new Request('https://example.com/health', { method: 'GET' });
      const url = new URL(req.url);
      const ctx = makeCtx({ resource: 'health', sub: null, req, url, sendJson });

      const res = await handlePublicRoutes(ctx);
      const payload = JSON.parse(await res.text());

      expect(payload.success).toBe(true);
      expect(payload.status).toBe('ok');
      expect(typeof payload.timestamp).toBe('string');
    });
  });

  it('returns null for non-public routes (fall-through)', async () => {
    const req = new Request('https://example.com/other', { method: 'GET' });
    const url = new URL(req.url);
    const ctx = makeCtx({ resource: 'other', sub: null, req, url });

    const res = await handlePublicRoutes(ctx);
    expect(res).toBeNull();
  });
});

describe('metaFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalAbortSignal = (globalThis as any).AbortSignal;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    if (!AbortSignal.timeout) {
      (AbortSignal as any).timeout = (ms: number) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
      };
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAbortSignal) {
      (globalThis as any).AbortSignal = originalAbortSignal;
    } else {
      delete (globalThis as any).AbortSignal;
    }
    vi.restoreAllMocks();
  });

  it('builds the URL correctly and returns data on success', async () => {
    const path = 'v20.0/me';
    const params = { fields: 'id,name', limit: '10' };
    const token = 'test-token';
    const responseJson = { id: '123', name: 'Test User' };

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify(responseJson)),
    } as any);

    const result = await metaFetch(path, params, token);

    expect(result).toEqual(responseJson);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = fetchMock.mock.calls[0];
    const urlObj = new URL(calledUrl as string);
    expect(urlObj.origin + urlObj.pathname).toBe(`${META_GRAPH}${path}`);
    expect(urlObj.searchParams.get('access_token')).toBe(token);
    expect(urlObj.searchParams.get('fields')).toBe('id,name');
    expect(urlObj.searchParams.get('limit')).toBe('10');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws error from d.error.message when response is not ok', async () => {
    const path = 'v20.0/me';
    const token = 't';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'OAuthException: Invalid token' } })),
    } as any);

    await expect(() => metaFetch(path, {}, token)).rejects.toThrow('OAuthException: Invalid token');
  });

  it('falls back to d.message when error.message is absent', async () => {
    const path = 'v20.0/me';
    const token = 't';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue(JSON.stringify({ message: 'Rate limit exceeded' })),
    } as any);

    await expect(() => metaFetch(path, {}, token)).rejects.toThrow('Rate limit exceeded');
  });

  it('falls back to text when no error object is present', async () => {
    const path = 'v20.0/me';
    const token = 't';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Some raw error text'),
    } as any);

    await expect(() => metaFetch(path, {}, token)).rejects.toThrow('Some raw error text');
  });

  it('falls back to default Meta API status text when no text is present', async () => {
    const path = 'v20.0/me';
    const token = 't';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue(''),
    } as any);

    await expect(() => metaFetch(path, {}, token)).rejects.toThrow('Meta API 403');
  });
});

describe('parseMetaMetric', () => {
  it('returns the same finite number for numeric input', () => {
    expect(parseMetaMetric(42)).toBe(42);
    expect(parseMetaMetric(-1.5)).toBe(-1.5);
  });

  it('returns 0 for non-finite numbers', () => {
    expect(parseMetaMetric(Number.NaN)).toBe(0);
    expect(parseMetaMetric(Infinity)).toBe(0);
    expect(parseMetaMetric(-Infinity)).toBe(0);
  });

  it('parses numeric strings and ignores invalid strings', () => {
    expect(parseMetaMetric('123')).toBe(123);
    expect(parseMetaMetric(' 45.67 ')).toBe(45.67);
    expect(parseMetaMetric('abc')).toBe(0);
  });

  it('sums arrays recursively', () => {
    expect(parseMetaMetric([10, '20', { value: 5 }, { value: '15.5' }, { value: 'abc' }])).toBe(50.5);
  });

  it('parses objects with a value property', () => {
    expect(parseMetaMetric({ value: 100 })).toBe(100);
    expect(parseMetaMetric({ value: '200.5' })).toBe(200.5);
    expect(parseMetaMetric({ value: 'abc' })).toBe(0);
  });

  it('returns 0 for unsupported values', () => {
    expect(parseMetaMetric(null)).toBe(0);
    expect(parseMetaMetric(undefined)).toBe(0);
    expect(parseMetaMetric(true)).toBe(0);
  });
});

describe('extractMetaAccountRawValue', () => {
  it('returns empty string for null and undefined', () => {
    expect(extractMetaAccountRawValue(null)).toBe('');
    expect(extractMetaAccountRawValue(undefined)).toBe('');
  });

  it('extracts adAccountId from object and trims whitespace', () => {
    expect(extractMetaAccountRawValue({ adAccountId: '  act_12345  ' })).toBe('act_12345');
  });

  it('falls back to ad_account_id when adAccountId is missing', () => {
    expect(extractMetaAccountRawValue({ ad_account_id: '  act_67890  ' })).toBe('act_67890');
  });

  it('prefers adAccountId over ad_account_id when both are present', () => {
    expect(extractMetaAccountRawValue({ adAccountId: '  primary-id  ', ad_account_id: 'secondary-id' })).toBe('primary-id');
  });

  it('returns empty string when object has no recognized account keys', () => {
    expect(extractMetaAccountRawValue({ other: 'value' })).toBe('');
  });

  it('converts numeric values to string and trims them', () => {
    expect(extractMetaAccountRawValue(123456)).toBe('123456');
  });

  it('returns empty string for unsupported types such as booleans and symbols', () => {
    expect(extractMetaAccountRawValue(true)).toBe('');
    expect(extractMetaAccountRawValue(Symbol('x'))).toBe('');
  });
});

describe('actionValue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0 for non-array actions', () => {
    const matcher = vi.fn().mockReturnValue(true);
    expect(actionValue(null, matcher)).toBe(0);
    expect(actionValue('string', matcher)).toBe(0);
    expect(matcher).not.toHaveBeenCalled();
  });

  it('sums matched action values via parseMetaMetric', () => {
    const actions = [
      { action_type: 'CLICK', value: 10 },
      { action_type: 'click', value: '5' },
      { action_type: 'view', value: 100 },
      { action_type: 'click', value: 3.5 },
    ];
    const matcher = vi.fn((type: string) => type === 'click');
    expect(actionValue(actions, matcher)).toBeCloseTo(18.5);
    expect(matcher).toHaveBeenCalledTimes(4);
  });

  it('normalizes action_type to lowercase before matching', () => {
    const actions = [{ action_type: 'CLiCk', value: 1 }, { action_type: 'CLICK', value: 2 }];
    const matcher = vi.fn((type: string) => type === 'click');
    expect(actionValue(actions, matcher)).toBe(3);
    expect(matcher.mock.calls.map((call: unknown[]) => call[0])).toEqual(['click', 'click']);
  });

  it('skips unmatched actions and only parses matched values', () => {
    const actions = [{ action_type: 'click', value: 10 }, { action_type: 'view', value: 20 }];
    const matcher = vi.fn((type: string) => type === 'view');
    expect(actionValue(actions, matcher)).toBe(20);
    expect(matcher).toHaveBeenCalledTimes(2);
  });

  it('coerces missing action_type to empty string and still matches', () => {
    const actions = [{ value: 5 }, { action_type: null, value: 10 } as any];
    const matcher = vi.fn(() => true);
    expect(actionValue(actions, matcher)).toBe(15);
    expect(matcher).toHaveBeenCalledTimes(2);
  });
});

describe('buildCampaignsTimeRange', () => {
  // Pin a fixed "now" to make assertions deterministic
  const now = new Date('2024-06-15T12:00:00Z').getTime(); // 2024-06-15

  it('uses campTo as until and campFrom as since when both are provided', () => {
    const result = JSON.parse(buildCampaignsTimeRange('2024-05-01', '2024-06-01', 30, now));
    expect(result.since).toBe('2024-05-01');
    expect(result.until).toBe('2024-06-01');
  });

  it('uses campDays to compute since when from/to are absent', () => {
    const result = JSON.parse(buildCampaignsTimeRange('', '', 30, now));
    // since = now - 30 days = 2024-05-16
    expect(result.since).toBe('2024-05-16');
    expect(result.until).toBe('2024-06-15');
  });

  it('clamps since to 90 days back when campDays exceeds 90', () => {
    const result = JSON.parse(buildCampaignsTimeRange('', '', 120, now));
    // Clamped to now - 90 days = 2024-03-17
    const expected = new Date(now - 90 * 86_400_000).toISOString().slice(0, 10);
    expect(result.since).toBe(expected);
  });

  it('clamps since to 90 days back when campFrom is more than 90 days ago', () => {
    const result = JSON.parse(buildCampaignsTimeRange('2020-01-01', '2024-06-10', 30, now));
    const expected = new Date(now - 90 * 86_400_000).toISOString().slice(0, 10);
    expect(result.since).toBe(expected);
    // until is still the explicit campTo
    expect(result.until).toBe('2024-06-10');
  });

  it('falls back to 90-day window when campDays is NaN', () => {
    const result = JSON.parse(buildCampaignsTimeRange('', '', Number.NaN, now));
    const expected = new Date(now - 90 * 86_400_000).toISOString().slice(0, 10);
    expect(result.since).toBe(expected);
    expect(result.until).toBe('2024-06-15');
  });

  it('uses today as until when campTo is absent', () => {
    const result = JSON.parse(buildCampaignsTimeRange('', '', 7, now));
    expect(result.until).toBe('2024-06-15');
  });
});
