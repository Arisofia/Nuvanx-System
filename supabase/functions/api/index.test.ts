import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
