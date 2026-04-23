// shared/phone.ts
// Normaliza un número de teléfono a formato E.164
export function normalizePhoneToE164(phone: string | null | undefined, countryCode: string = '34'): string {
  const raw = String(phone ?? '').trim();
  if (!raw) return '';

  const cleaned = raw.replace(/[\u00A0\s().-]/g, '').replace(/ext\.?\s*\d+$/i, '');
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

export function normalizePhoneForMeta(phone: string | null | undefined, countryCode: string = '34'): string {
  const e164 = normalizePhoneToE164(phone, countryCode);
  return e164 ? e164.slice(1) : '';
}
