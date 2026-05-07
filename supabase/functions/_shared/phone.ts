export function normalizePhoneToE164(input: string | null | undefined, countryCode?: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  const cleaned = raw.replaceAll(/\u00A0|\s|\(|\)|\.|-/g, '').replaceAll(/ext\.?\s*\d+$/gi, '');
  if (!cleaned) return '';

  let candidate = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;

  if (candidate.startsWith('+')) {
    const digits = candidate.slice(1).replaceAll(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return '';
    return `+${digits}`;
  }

  const digits = candidate.replaceAll(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';

  const countryCodeRaw = countryCode ?? (globalThis as any).Deno?.env?.get('DEFAULT_PHONE_COUNTRY_CODE') ?? (globalThis as any).process?.env?.DEFAULT_PHONE_COUNTRY_CODE;
  const fallbackCountryCode = String(countryCodeRaw ?? '').replaceAll(/\D/g, '');

  if (!fallbackCountryCode) return '';
  if (digits.length <= 12 && !digits.startsWith(fallbackCountryCode)) {
    return `+${fallbackCountryCode}${digits}`;
  }

  return `+${digits}`;
}

export function normalizePhoneForMeta(input: string | null | undefined): string | null {
  try {
    const e164 = normalizePhoneToE164(input);
    return e164 ? e164.slice(1) : null;
  } catch {
    return null;
  }
}

export type PhoneNormalizationFailureReason = 'invalid-format' | 'missing-default-country-code';

export function getPhoneNormalizationFailureReason(input: string | null | undefined): PhoneNormalizationFailureReason | null {
  const raw = String(input ?? '').trim();
  if (!raw) return 'invalid-format';

  const cleaned = raw.replaceAll(/\u00A0|\s|\(|\)|\.|-/g, '').replaceAll(/ext\.?\s*\d+$/gi, '');
  if (!cleaned) return 'invalid-format';

  let candidate = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  if (candidate.startsWith('+')) {
    const digits = candidate.slice(1).replaceAll(/\D/g, '');
    return digits.length < 8 || digits.length > 15 ? 'invalid-format' : null;
  }

  const digits = candidate.replaceAll(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return 'invalid-format';

  const countryCodeRaw = (globalThis as any).Deno?.env?.get('DEFAULT_PHONE_COUNTRY_CODE') ?? (globalThis as any).process?.env?.DEFAULT_PHONE_COUNTRY_CODE;
  const fallbackCountryCode = String(countryCodeRaw ?? '').replaceAll(/\D/g, '');

  return fallbackCountryCode ? null : 'missing-default-country-code';
}
