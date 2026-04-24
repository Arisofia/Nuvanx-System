// backend/src/utils/phone.js
'use strict';

function normalizePhoneToE164(rawPhone, fallbackCountry = '34') {
  const input = String(rawPhone ?? '').trim();
  if (!input) return '';

  const cleaned = input.replaceAll(/\u00A0|\s|\(|\)|\.|-/g, '').replace(/ext\.?\s*\d+$/i, '');
  if (!cleaned) return '';

  let candidate = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  if (!candidate.startsWith('+')) {
    const digits = candidate.replace(/\D/g, '');
    if (fallbackCountry && digits.length <= 12 && !digits.startsWith(fallbackCountry)) {
      candidate = `+${fallbackCountry}${digits}`;
    } else {
      candidate = `+${digits}`;
    }
  }

  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return `+${digits}`;
}

function normalizePhoneForMeta(rawPhone, fallbackCountry = '34') {
  const e164 = normalizePhoneToE164(rawPhone, fallbackCountry);
  return e164 ? e164.slice(1) : '';
}

module.exports = {
  normalizePhoneToE164,
  normalizePhoneForMeta,
};
