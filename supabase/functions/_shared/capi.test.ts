import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sha256Hex } from './capi.ts';

describe('sha256Hex', () => {
  let hadCrypto = false;

  beforeEach(() => {
    hadCrypto = typeof globalThis.crypto !== 'undefined';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (!hadCrypto) {
      delete (globalThis as any).crypto;
    }
  });

  it('returns empty string for empty, whitespace-only, null or undefined input', async () => {
    const inputs: Array<string | null | undefined> = ['', '   ', '\n\t', null, undefined];
    const results = await Promise.all(inputs.map((value) => sha256Hex(value as any)));
    results.forEach((result) => expect(result).toBe(''));
  });

  it('lowercases and trims input before hashing', async () => {
    const hash1 = await sha256Hex('  HeLLo  ');
    const hash2 = await sha256Hex('hello');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a valid lowercase SHA-256 hex string for normalized input', async () => {
    const input = 'Test-String-123';
    const hash = await sha256Hex(input);
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const expectedDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.toLowerCase()));
    const expectedHex = Array.from(new Uint8Array(expectedDigest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hash).toBe(expectedHex);
  });

  it('calls crypto.subtle.digest with the normalized UTF-8-encoded input', async () => {
    const digestMock = vi.fn().mockResolvedValue(new ArrayBuffer(32));
    vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue({ subtle: { digest: digestMock } } as any);

    const result = await sha256Hex('  ABC  ');
    expect(result).toBe('0'.repeat(64));
    expect(digestMock).toHaveBeenCalledTimes(1);
    const [algo, buffer] = digestMock.mock.calls[0];
    expect(algo).toBe('SHA-256');
    expect(new TextDecoder().decode(buffer as ArrayBuffer)).toBe('abc');
  });

  it('propagates errors from crypto.subtle.digest', async () => {
    const error = new Error('digest failed');
    const digestMock = vi.fn().mockRejectedValue(error);
    vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue({ subtle: { digest: digestMock } } as any);

    await expect(() => sha256Hex('fail-me')).rejects.toBe(error);
    expect(digestMock).toHaveBeenCalledTimes(1);
  });

  it('returns empty string when normalized string is empty after trimming non-string inputs', async () => {
    const input = '\u00A0\u00A0';
    const result = await sha256Hex(input);
    expect(result).toBe('');
  });
});
