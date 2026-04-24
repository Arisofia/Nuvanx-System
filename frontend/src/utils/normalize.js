// frontend/src/utils/normalize.js
export function normalizeMetaAccountId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const unprefixed = value.replace(/^act_/i, '');
  const digits = unprefixed.replace(/\D/g, '');
  return digits ? `act_${digits}` : '';
}

export function normalizePhoneNumberId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const unprefixed = value.replace(/^act_/i, '');
  if (/[a-z]/i.test(unprefixed)) return '';
  const digits = unprefixed.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 20) return '';
  return digits;
}
