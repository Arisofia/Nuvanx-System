// shared/phone.ts
// Normaliza un número de teléfono a formato E.164
export function normalizePhoneToE164(phone: string, countryCode: string = '34'): string {
  let normalized = phone.trim().replace(/\D/g, '');
  if (normalized.startsWith('00')) {
    normalized = '+' + normalized.slice(2);
  } else if (normalized.startsWith('0')) {
    normalized = countryCode + normalized.slice(1);
  } else if (!normalized.startsWith('+')) {
    if (normalized.startsWith(countryCode)) {
      normalized = '+' + normalized;
    } else {
      normalized = '+' + countryCode + normalized;
    }
  }
  if (!normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }
  return normalized;
}
