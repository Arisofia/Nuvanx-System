import { describe, expect, it } from 'vitest';
import {
  getPhoneNormalizationFailureReason,
  normalizePhoneForMeta,
  normalizePhoneToE164,
} from './phone.ts';

describe('shared phone normalization', () => {
  it('normalizes local Spanish numbers to E.164 using the configured country code', () => {
    process.env.DEFAULT_PHONE_COUNTRY_CODE = '34';

    expect(normalizePhoneToE164('612 345 678')).toBe('+34612345678');
    expect(normalizePhoneForMeta('612-345-678')).toBe('34612345678');
  });

  it('preserves already international numbers and strips 00 prefixes', () => {
    process.env.DEFAULT_PHONE_COUNTRY_CODE = '34';

    expect(normalizePhoneToE164('+34 612 345 678')).toBe('+34612345678');
    expect(normalizePhoneToE164('0034 612 345 678')).toBe('+34612345678');
  });

  it('reports missing default country code for otherwise valid local numbers', () => {
    delete process.env.DEFAULT_PHONE_COUNTRY_CODE;

    expect(getPhoneNormalizationFailureReason('612345678')).toBe('missing-default-country-code');
  });
});
