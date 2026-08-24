import { describe, expect, it } from 'vitest';
import { resolveMetaDateRange } from './date-range.ts';

describe('Meta daily insight date ranges', () => {
  it('preserves the legacy rolling lookback semantics', () => {
    expect(resolveMetaDateRange({ days: 2 }, new Date('2026-08-24T08:00:00Z'))).toEqual({
      since: '2026-08-22',
      until: '2026-08-24',
      mode: 'rolling',
      lookback_days: 2,
    });
  });

  it('honours the explicit reconciliation window sent by Master System', () => {
    expect(resolveMetaDateRange({ from: '2026-08-01', to: '2026-08-24' })).toEqual({
      since: '2026-08-01',
      until: '2026-08-24',
      mode: 'explicit',
      lookback_days: null,
    });
  });

  it('fails closed on partial, invalid, reversed or excessive ranges', () => {
    expect(() => resolveMetaDateRange({ from: '2026-08-01' })).toThrow(/provided together/);
    expect(() => resolveMetaDateRange({ from: '2026-02-30', to: '2026-03-01' })).toThrow(/valid calendar date/);
    expect(() => resolveMetaDateRange({ from: '2026-08-24', to: '2026-08-01' })).toThrow(/on or before/);
    expect(() => resolveMetaDateRange({ from: '2026-01-01', to: '2026-08-24' })).toThrow(/cannot exceed/);
    expect(() => resolveMetaDateRange({ days: 0 })).toThrow(/integer between/);
  });
});
