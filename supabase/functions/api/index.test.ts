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
      return { ...((originalDenoDescriptor.get ? originalDenoDescriptor.get.call(globalThis) : (originalDenoDescriptor.value as any)) ?? {}), serve: vi.fn() };
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
  META_GRAPH,
  metaFetch,
  parseJsonOrText,
  parseMetaMetric,
  actionValue,
} = api;

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
    ['http://example.com', 'HTTP://example.com', 'ftp://example.com', 'ws://example.com'].forEach((input) => {
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
    vi.spyOn(globalThis, 'Deno', 'get').mockReturnValue(undefined as any);
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

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno')!;
    const getterUnderTest = () => {
      return {
        ...(
          (descriptor.get
            ? descriptor.get.call(globalThis)
            : (descriptor.value as any)) ?? {}
        ),
        serve: vi.fn(),
      };
    };

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

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno')!;
    const getterUnderTest = () => {
      return {
        ...(
          (descriptor.get
            ? descriptor.get.call(globalThis)
            : (descriptor.value as any)) ?? {}
        ),
        serve: vi.fn(),
      };
    };

    const result = getterUnderTest();

    expect(result.hello).toBe('world');
    expect(typeof result.serve).toBe('function');
  });

  it('handles descriptor with neither get nor value, returning an object with only serve (edge case)', () => {
    Object.defineProperty(globalThis, 'Deno', {
      configurable: true,
      value: undefined,
    });

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno')!;
    const getterUnderTest = () => {
      return {
        ...(
          (descriptor.get
            ? descriptor.get.call(globalThis)
            : (descriptor.value as any)) ?? {}
        ),
        serve: vi.fn(),
      };
    };

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

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno')!;
    const getterUnderTest = () => {
      return {
        ...(
          (descriptor.get
            ? descriptor.get.call(globalThis)
            : (descriptor.value as any)) ?? {}
        ),
        serve: vi.fn(),
      };
    };

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

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno')!;
    const getterUnderTest = () => {
      return {
        ...(
          (descriptor.get
            ? descriptor.get.call(globalThis)
            : (descriptor.value as any)) ?? {}
        ),
        serve: vi.fn(),
      };
    };

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
    vi.spyOn(globalThis, 'Deno', 'get').mockReturnValue({ env: { get: vi.fn() } } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (denoDescriptor) Object.defineProperty(globalThis, 'Deno', denoDescriptor);
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  });

  it('throws when ENCRYPTION_KEY is not set', async () => {
    const deno = (globalThis as any).Deno;
    deno.env.get.mockReturnValue(undefined);
    await expect(() => decryptCred('aa:bb:cc:dd')).rejects.toThrowError('ENCRYPTION_KEY not set in Edge Function secrets');
    expect(deno.env.get).toHaveBeenCalledWith('ENCRYPTION_KEY');
  });

  it('throws for malformed ciphertext strings that do not have 4 parts', async () => {
    const deno = (globalThis as any).Deno;
    deno.env.get.mockReturnValue('dummy-key');
    for (const encoded of ['one-part', 'a:b:c', 'a:b:c:d:e']) {
      await expect(() => decryptCred(encoded as any)).rejects.toThrowError('malformed ciphertext');
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

    const importKeyMock = vi.fn().mockResolvedValue('km-object');
    const deriveKeyMock = vi.fn().mockResolvedValue('aes-key-object');
    const decryptMock = vi.fn().mockResolvedValue(new TextEncoder().encode('decrypted-value'));
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
      for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return arr;
    });
    vi.spyOn(globalThis.crypto.subtle, 'importKey').mockResolvedValue('km-object' as any);
    vi.spyOn(globalThis.crypto.subtle, 'deriveKey').mockResolvedValue('aes-key-object' as any);
    vi.spyOn(globalThis.crypto.subtle, 'decrypt').mockRejectedValue(new Error('Decrypt failed'));

    await expect(() => decryptCred('aa:bb:ccdd:0102')).rejects.toThrowError('Decrypt failed');
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
    expect((options as any).signal).toBeInstanceOf(AbortSignal);
  });

  it('throws error from d.error.message when response is not ok', async () => {
    const path = 'v20.0/me';
    const token = 't';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'OAuthException: Invalid token' } })),
    } as any);

    await expect(() => metaFetch(path, {}, token)).rejects.toThrowError('OAuthException: Invalid token');
  });

  it('falls back to d.message when error.message is absent', async () => {
    const path = 'v20.0/me';
    const token = 't';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue(JSON.stringify({ message: 'Rate limit exceeded' })),
    } as any);

    await expect(() => metaFetch(path, {}, token)).rejects.toThrowError('Rate limit exceeded');
  });

  it('falls back to text when no error object is present', async () => {
    const path = 'v20.0/me';
    const token = 't';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Some raw error text'),
    } as any);

    await expect(() => metaFetch(path, {}, token)).rejects.toThrowError('Some raw error text');
  });

  it('falls back to default Meta API status text when no text is present', async () => {
    const path = 'v20.0/me';
    const token = 't';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue(''),
    } as any);

    await expect(() => metaFetch(path, {}, token)).rejects.toThrowError('Meta API 403');
  });
});

describe('parseMetaMetric', () => {
  it('returns the same finite number for numeric input', () => {
    expect(parseMetaMetric(42)).toBe(42);
    expect(parseMetaMetric(-1.5)).toBe(-1.5);
  });

  it('returns 0 for non-finite numbers', () => {
    expect(parseMetaMetric(NaN)).toBe(0);
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
    expect(matcher.mock.calls.map((call) => call[0])).toEqual(['click', 'click']);
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
