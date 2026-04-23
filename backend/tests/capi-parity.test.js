'use strict';

const crypto = require('crypto');
const { normalizePhoneToE164, normalizePhoneForMeta } = require('../src/utils/phone');
const { deriveCapiExternalId, mapLeadPayloadToCapiEvent } = require('../src/services/metaCapi');

function edgeNormalizePhoneToE164(phone, defaultCountry = '34') {
  const raw = String(phone ?? '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[\u00A0\s().-]/g, '').replace(/ext\.?\s*\d+$/i, '');
  if (!cleaned) return '';
  let candidate = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  if (!candidate.startsWith('+')) {
    const digits = candidate.replace(/\D/g, '');
    if (defaultCountry && digits.length <= 12 && !digits.startsWith(defaultCountry)) {
      candidate = `+${defaultCountry}${digits}`;
    } else {
      candidate = `+${digits}`;
    }
  }
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return `+${digits}`;
}

function edgePhoneForMeta(phone) {
  const e164 = edgeNormalizePhoneToE164(phone);
  return e164 ? e164.slice(1) : '';
}

function edgeSha256(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function edgeDeriveExternalId({ phone = '', email = '' }) {
  const normalizedPhone = edgePhoneForMeta(phone);
  if (normalizedPhone) return edgeSha256(normalizedPhone);
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  return normalizedEmail ? edgeSha256(normalizedEmail) : '';
}

function edgeMapLeadPayloadToCapiEvent(payload = {}) {
  const stage = String(payload.stage ?? '').toLowerCase();
  const source = String(payload.source ?? '').toLowerCase();
  const revenue = Number(payload.revenue ?? 0);
  const isQualified = payload.lead_quality === 'qualified' || payload.is_qualified === true;
  const attended = payload.status === 'attended' || payload.appointment_status === 'attended';

  if (stage === 'whatsapp' || source.includes('whatsapp')) return { eventName: 'Contact' };
  if (isQualified) return { eventName: 'Lead', customData: { lead_quality: 'qualified' } };
  if (stage === 'appointment') return { eventName: 'Schedule', customData: attended ? { status: 'attended' } : {} };
  if (stage === 'treatment' || stage === 'closed') {
    if (revenue > 1500) return { eventName: 'Purchase', value: revenue, customData: { content_category: 'premium' } };
    return { eventName: 'Purchase', value: revenue };
  }
  return { eventName: 'Lead' };
}

describe('CAPI parity contract (backend vs edge semantics)', () => {
  test.each([
    ['+34 612 345 678', '+34612345678'],
    ['612345678', '+34612345678'],
    ['0034 612 345 678', '+34612345678'],
    ['(346)12345678', '+34612345678'],
  ])('normalizePhoneToE164 parity for %s', (input, expected) => {
    expect(normalizePhoneToE164(input)).toBe(expected);
    expect(edgeNormalizePhoneToE164(input)).toBe(expected);
  });

  test('normalizePhoneForMeta parity', () => {
    expect(normalizePhoneForMeta('612345678')).toBe(edgePhoneForMeta('612345678'));
  });

  test('deriveCapiExternalId parity (phone first)', () => {
    const backend = deriveCapiExternalId({ phone: '612345678', email: 'alt@example.com' });
    const edge = edgeDeriveExternalId({ phone: '612345678', email: 'alt@example.com' });
    expect(backend).toBe(edge);
  });

  test('deriveCapiExternalId parity (email fallback)', () => {
    const backend = deriveCapiExternalId({ phone: '', email: 'Lead@Example.com' });
    const edge = edgeDeriveExternalId({ phone: '', email: 'Lead@Example.com' });
    expect(backend).toBe(edge);
  });

  test.each([
    [{ source: 'meta_leadgen', stage: 'lead' }, { eventName: 'Lead' }],
    [{ source: 'whatsapp', stage: 'lead' }, { eventName: 'Contact' }],
    [{ stage: 'appointment' }, { eventName: 'Schedule', customData: {} }],
    [{ stage: 'appointment', status: 'attended' }, { eventName: 'Schedule', customData: { status: 'attended' } }],
    [{ stage: 'treatment', revenue: 500 }, { eventName: 'Purchase', value: 500 }],
    [{ stage: 'closed', revenue: 2000 }, { eventName: 'Purchase', value: 2000, customData: { content_category: 'premium' } }],
  ])('mapLeadPayloadToCapiEvent parity %#', (input, expected) => {
    expect(mapLeadPayloadToCapiEvent(input)).toEqual(expected);
    expect(edgeMapLeadPayloadToCapiEvent(input)).toEqual(expected);
  });
});
