'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  digits,
  micros,
  mapGoogleRow,
  validateMappedRow,
} = require('./sync-google-ads-insights');

test('digits normalizes Google Ads customer ids', () => {
  assert.equal(digits('908-454-0447'), '9084540447');
  assert.equal(digits(' 820 148 9748 '), '8201489748');
});

test('micros converts Google Ads micros to account currency', () => {
  assert.equal(micros('42700000'), 42.7);
  assert.equal(micros(129780000), 129.78);
});

test('mapGoogleRow preserves campaign-day identity and fractional conversions', () => {
  const integration = {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: '22222222-2222-2222-2222-222222222222',
    clinic_id: null,
    customer_id: '9084540447',
  };
  const row = {
    segments: { date: '2026-08-31' },
    customer: { currencyCode: 'EUR' },
    campaign: {
      id: '24167785177',
      name: 'NUVANX_Search_Diagnostic_MaxConv_Madrid',
      status: 'ENABLED',
      advertisingChannelType: 'SEARCH',
    },
    metrics: {
      impressions: '308',
      clicks: '33',
      costMicros: '42700000',
      conversions: 0.5,
      conversionsValue: 150,
      ctr: 0.1071428571,
      averageCpc: '1293939',
      costPerConversion: '85400000',
    },
  };

  const mapped = mapGoogleRow(row, integration, '2026-09-01T00:00:00.000Z');
  validateMappedRow(mapped);

  assert.equal(mapped.customer_id, '9084540447');
  assert.equal(mapped.campaign_id, '24167785177');
  assert.equal(mapped.date, '2026-08-31');
  assert.equal(mapped.spend, 42.7);
  assert.equal(mapped.conversions, 0.5);
  assert.equal(mapped.currency_code, 'EUR');
  assert.equal(mapped.clinic_id, null);
});

test('validateMappedRow rejects rows without canonical identity', () => {
  assert.throws(
    () => validateMappedRow({ customer_id: '', campaign_id: '1', date: '2026-08-31', user_id: 'u', integration_id: 'i' }),
    /canonical identity/,
  );
});
