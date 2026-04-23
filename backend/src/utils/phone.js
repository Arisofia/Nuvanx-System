'use strict';

const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_PHONE_COUNTRY_CODE || '34';

function normalizePhoneToE164(rawPhone, fallbackCountryCode = DEFAULT_COUNTRY_CODE) {
  if (!rawPhone) return null;

  const cleaned = String(rawPhone)
    .trim()
    .replace(/[\u00A0\s().-]/g, '')
    .replace(/ext\.?\s*\d+$/i, '');

  if (!cleaned) return null;

  let candidate = cleaned;
  if (candidate.startsWith('00')) candidate = `+${candidate.slice(2)}`;

  if (candidate.startsWith('+')) {
    const digits = candidate.slice(1).replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  const digitsOnly = candidate.replace(/\D/g, '');
  if (digitsOnly.length < 8 || digitsOnly.length > 15) return null;

  if (digitsOnly.length === 10) return `+1${digitsOnly}`;
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) return `+${digitsOnly}`;
  if (digitsOnly.length === 9 && fallbackCountryCode) return `+${fallbackCountryCode}${digitsOnly}`;

  return `+${digitsOnly}`;
}

function normalizePhoneForMeta(rawPhone, fallbackCountryCode) {
  const e164 = normalizePhoneToE164(rawPhone, fallbackCountryCode);
  if (!e164) return null;
  return e164.slice(1);
}

module.exports = {
  normalizePhoneToE164,
  normalizePhoneForMeta,
};
