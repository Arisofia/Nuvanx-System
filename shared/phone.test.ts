import { describe, it, expect } from 'vitest';
import { normalizePhoneToE164 } from './phone.ts';

describe('normalizePhoneToE164', () => {
  it('returns empty string for null, undefined, empty, or whitespace-only inputs', () => {
    const cases: Array<string | null | undefined> = [null, undefined, '', '   ', '\u00A0\u00A0'];
    const results = cases.map((value) => normalizePhoneToE164(value));
    results.forEach((result) => expect(result).toBe(''));
  });

  it('removes spaces, non-breaking spaces, parentheses, dots, dashes and extension suffix', () => {
    const input = ' (123) 456-7890 ext. 123 ';
    const result = normalizePhoneToE164(input);
    expect(result).toBe('+341234567890');
  });

  it('removes extension regardless of capitalization and spacing for international numbers', () => {
    const input = ' +49 123 456 789 ext 999 ';
    const result = normalizePhoneToE164(input, '49');
    expect(result).toBe('+49123456789');
  });

  it('converts international 00 prefix to + and validates digits length', () => {
    const input = '0044 (0)20 7946 0958';
    const result = normalizePhoneToE164(input, '34');
    expect(result).toBe('+4402079460958');
  });

  it('keeps a valid +E164 number and strips non-digits', () => {
    const input = '+1 (415) 555-2671';
    const result = normalizePhoneToE164(input);
    expect(result).toBe('+14155552671');
  });

  it('returns empty string for + prefixed numbers with too few digits', () => {
    expect(normalizePhoneToE164('+12345')).toBe('');
  });

  it('returns empty string for + prefixed numbers with too many digits', () => {
    expect(normalizePhoneToE164('+1234567890123456')).toBe('');
  });

  it('returns empty string for cleaned non-prefixed numbers with too few digits', () => {
    expect(normalizePhoneToE164('12345')).toBe('');
  });

  it('returns empty string for cleaned non-prefixed numbers with too many digits', () => {
    expect(normalizePhoneToE164('12345678901234567')).toBe('');
  });

  it('adds countryCode when digits length <= 12 and digits do not already start with it', () => {
    const result = normalizePhoneToE164('612 34 56 78', '34');
    expect(result).toBe('+34612345678');
  });

  it('does not duplicate countryCode when digits already start with it', () => {
    const result = normalizePhoneToE164('34123456789', '34');
    expect(result).toBe('+34123456789');
  });

  it('skips countryCode addition when digit length is greater than 12', () => {
    const result = normalizePhoneToE164('1234567890123', '34');
    expect(result).toBe('+1234567890123');
  });

  it('never prefixes when countryCode is empty', () => {
    const result = normalizePhoneToE164('12345678', '');
    expect(result).toBe('+12345678');
  });

  it('coerces non-string inputs and normalizes digits', () => {
    expect(normalizePhoneToE164(123456789 as any, '1')).toBe('+123456789');
    expect(normalizePhoneToE164(true as any, '1')).toBe('');
  });

  it('returns empty string when cleaned input becomes empty after removing formatting and ext text', () => {
    const input = ' ( ) - . \u00A0 ext 123 ';
    expect(normalizePhoneToE164(input)).toBe('');
  });
});
