export function normalizePhoneNumberId(raw) {
  const value = String(raw || '').trim();
  if (!value || /^act_/i.test(value) || /[a-z]/i.test(value)) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 20) return '';
  return digits;
}
