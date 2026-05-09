if (typeof process !== 'undefined' && !process.config) {
  (process as any).config = {};
}

const g = globalThis as any;

import { normalizePhoneToE164 } from './phone.ts';

// globalThis in the browser lib doesn't declare `process` or `Deno`.
// Cast once here so vi.spyOn calls below don't need per-site casts.
describe('normalizePhoneToE164', () => {
  const originalProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const originalDenoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno');

  beforeEach(() => {
    if (originalProcessDescriptor) {
      vi.spyOn(g, 'process', 'get').mockReturnValue({ env: {} } as any);
    }
    if (originalDenoDescriptor) {
      vi.spyOn(g, 'Deno', 'get').mockReturnValue(undefined as any);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (!originalDenoDescriptor && Object.prototype.hasOwnProperty.call(globalThis, 'Deno')) {
      delete (globalThis as any).Deno;
    }
  });

  it('returns empty string for null / undefined / empty / whitespace-only input', () => {
    const cases: Array<string | null | undefined> = [null, undefined, '', '   ', '\u00A0\u00A0'];
    const results = cases.map((value) => normalizePhoneToE164(value));
    results.forEach((result) => expect(result).toBe(''));
  });

  it('cleans common formatting characters and extension suffix', () => {
    vi.spyOn(g, 'process', 'get').mockReturnValue({ env: { DEFAULT_PHONE_COUNTRY_CODE: '34' } } as any);
    const input = ' (123) 456-7890 ext. 123 ';
    const result = normalizePhoneToE164(input);
    expect(result).toBe('+341234567890');
  });

  it('converts 00 prefix to + and strips non-digits when already international', () => {
    vi.spyOn(g, 'process', 'get').mockReturnValue({ env: { DEFAULT_PHONE_COUNTRY_CODE: '34' } } as any);
    const input = '0044 (0)20 7946 0958';
    const result = normalizePhoneToE164(input);
    expect(result.startsWith('+44')).toBe(true);
    expect(result).toMatch(/^\+44\d+$/);
  });

  it('keeps + prefix and strips all non-digits after +', () => {
    const input = '+1 (415) 555-2671';
    const result = normalizePhoneToE164(input);
    expect(result).toBe('+14155552671');
  });

  it('returns empty string when + number has fewer than 8 digits', () => {
    expect(normalizePhoneToE164('+12345')).toBe('');
  });

  it('returns empty string when + number has more than 15 digits', () => {
    expect(normalizePhoneToE164('+1234567890123456')).toBe('');
  });

  it('returns empty string when local digits (no +) are < 8', () => {
    expect(normalizePhoneToE164('12345')).toBe('');
  });

  it('returns empty string when local digits (no +) are > 15', () => {
    expect(normalizePhoneToE164('12345678901234567')).toBe('');
  });

  it('uses DEFAULT_PHONE_COUNTRY_CODE from Deno.env if present', () => {
    const denoEnv = {
      env: {
        get: vi.fn().mockImplementation((key: string) => (key === 'DEFAULT_PHONE_COUNTRY_CODE' ? '49' : undefined)),
      },
    };
    Object.defineProperty(globalThis, 'Deno', {
      configurable: true,
      enumerable: true,
      value: denoEnv,
    });
    const input = ' 123 456 789 ';
    const result = normalizePhoneToE164(input);
    expect(result).toBe('+49123456789');
  });

  it('uses DEFAULT_PHONE_COUNTRY_CODE from process.env when Deno.env is not present', () => {
    vi.spyOn(g, 'process', 'get').mockReturnValue({ env: { DEFAULT_PHONE_COUNTRY_CODE: '1' } } as any);
    const input = '415 555 2671';
    const result = normalizePhoneToE164(input);
    expect(result).toBe('+14155552671');
  });

  it('throws when no country code env var is set', () => {
    vi.spyOn(g, 'process', 'get').mockReturnValue({ env: {} } as any);
    expect(() => normalizePhoneToE164('612345678')).toThrow('DEFAULT_PHONE_COUNTRY_CODE environment variable is not set');
  });

  it('sanitizes non-numeric characters from DEFAULT_PHONE_COUNTRY_CODE', () => {
    vi.spyOn(g, 'process', 'get').mockReturnValue({ env: { DEFAULT_PHONE_COUNTRY_CODE: 'cc-34' } } as any);
    const input = '612345678';
    const result = normalizePhoneToE164(input);
    expect(result).toBe('+34612345678');
  });

  it('does not prefix with country code when digits already start with it and length <= 12', () => {
    vi.spyOn(g, 'process', 'get').mockReturnValue({ env: { DEFAULT_PHONE_COUNTRY_CODE: '34' } } as any);
    const input = '34123456789';
    const result = normalizePhoneToE164(input);
    expect(result).toBe('+34123456789');
  });

  it('does not prefix with country code when digits length > 12', () => {
    vi.spyOn(g, 'process', 'get').mockReturnValue({ env: { DEFAULT_PHONE_COUNTRY_CODE: '34' } } as any);
    const input = '1234567890123';
    const result = normalizePhoneToE164(input);
    expect(result).toBe('+1234567890123');
  });

  it('throws when DEFAULT_PHONE_COUNTRY_CODE is empty string', () => {
    vi.spyOn(g, 'process', 'get').mockReturnValue({ env: { DEFAULT_PHONE_COUNTRY_CODE: '' } } as any);
    expect(() => normalizePhoneToE164('12345678')).toThrow('DEFAULT_PHONE_COUNTRY_CODE environment variable is not set');
  });

  it('coerces non-string input via String() and normalizes', () => {
    vi.spyOn(g, 'process', 'get').mockReturnValue({ env: { DEFAULT_PHONE_COUNTRY_CODE: '1' } } as any);
    expect(normalizePhoneToE164(123456789 as any)).toBe('+123456789');
    expect(normalizePhoneToE164(true as any)).toBe('');
  });

  it('returns empty string when input is only formatting chars and extension', () => {
    const input = ' ( ) - . \u00A0 ext 123 ';
    expect(normalizePhoneToE164(input)).toBe('');
  });
});
