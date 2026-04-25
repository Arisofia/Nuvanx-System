// backend/src/utils/phone.js
'use strict';

function normalizePhoneToE164(phone, countryCode = '34') {
  const raw = String(phone ?? '').trim();
  if (!raw) return '';

  const cleaned = raw.replaceAll(/\u00A0|\s|\(|\)|\.|-/g, '').replaceAll(/ext\.?\s*\d+$/i, '');
  if (!cleaned) return '';

  let candidate = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  if (candidate.startsWith('+')) {
    const digits = candidate.slice(1).replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return '';
    return `+${digits}`;
  }

  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  if (countryCode && digits.length <= 12 && !digits.startsWith(countryCode)) {
    return `+${countryCode}${digits}`;
  }
  return `+${digits}`;
}

function normalizePhoneForMeta(phone, countryCode = '34') {
  const e164 = normalizePhoneToE164(phone, countryCode);
  return e164 ? e164.slice(1) : '';
}

module.exports = {
  normalizePhoneToE164,
  normalizePhoneForMeta,
};
