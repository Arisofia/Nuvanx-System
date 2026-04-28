import { describe, it, expect } from 'vitest';
import { normalizeMetaAccountId } from './normalize.js';

describe('normalizeMetaAccountId', () => {
  it('returns a normalized account id with act_ prefix and digits only (happy path)', () => {
    const input = 'act_1234567890';
    const result = normalizeMetaAccountId(input);
    expect(result).toBe('act_1234567890');
  });

  it('strips non-digit characters and ensures act_ prefix for noisy input', () => {
    const input = '  act_123-456-7890  ';
    const result = normalizeMetaAccountId(input);
    expect(result).toBe('act_1234567890');
  });

  it('adds act_ prefix when missing and keeps digits only', () => {
    const input = '  987654321  ';
    const result = normalizeMetaAccountId(input);
    expect(result).toBe('act_987654321');
  });

  it('handles uppercase prefix and normalizes it to lowercase', () => {
    const input = 'ACT_123456';
    const result = normalizeMetaAccountId(input);
    expect(result).toBe('act_123456');
  });

  it('handles mixed prefix casing and extra text around id', () => {
    const input = '  aCt_123  456  foo  ';
    const result = normalizeMetaAccountId(input);
    expect(result).toBe('act_123456');
  });

  it('returns empty string when input is null, undefined, or empty', () => {
    const cases = [null, undefined, '', '   '];
    const results = cases.map((value) => normalizeMetaAccountId(value));
    results.forEach((result) => expect(result).toBe(''));
  });

  it('returns empty string when there are no digits after stripping prefix', () => {
    expect(normalizeMetaAccountId('act_abcdef')).toBe('');
    expect(normalizeMetaAccountId('abcdef')).toBe('');
    expect(normalizeMetaAccountId('act_!!!')).toBe('');
  });

  it('coerces non-string primitives to string and normalizes digits', () => {
    expect(normalizeMetaAccountId(123456)).toBe('act_123456');
    expect(normalizeMetaAccountId(true)).toBe('');
    expect(normalizeMetaAccountId({ toString: () => 'act_42X' })).toBe('act_42');
  });
});
