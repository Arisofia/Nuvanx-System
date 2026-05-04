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

  const nodeProcess = (globalThis as any).process;
  const fallbackCountryCode = (
    countryCode
      ?? (globalThis as any).Deno?.env?.get?.('DEFAULT_PHONE_COUNTRY_CODE')
      ?? nodeProcess?.env?.DEFAULT_PHONE_COUNTRY_CODE
      ?? ''
  ).toString().replaceAll(/\D/g, '');

  if (!fallbackCountryCode) {
    throw new Error('DEFAULT_PHONE_COUNTRY_CODE environment variable is not set. Phone normalization cannot proceed.');
  }

  if (digits.length <= 12 && !digits.startsWith(fallbackCountryCode)) {
    return `+${fallbackCountryCode}${digits}`;
  }

  return `+${digits}`;
}

export function normalizePhoneForMeta(input: string | null | undefined): string {
  const e164 = normalizePhoneToE164(input);
  return e164 ? e164.slice(1) : '';
}
