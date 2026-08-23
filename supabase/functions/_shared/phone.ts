type RuntimeEnvironment = {
  Deno?: {
    env?: {
      get?: (name: string) => string | undefined;
    };
  };
  process?: {
    env?: Record<string, string | undefined>;
  };
};

function getDefaultPhoneCountryCode(): string | undefined {
  const runtime = globalThis as typeof globalThis & RuntimeEnvironment;
  return runtime.Deno?.env?.get?.('DEFAULT_PHONE_COUNTRY_CODE') ?? runtime.process?.env?.DEFAULT_PHONE_COUNTRY_CODE;
}

export function normalizePhoneToE164(input: string | null | undefined, countryCode?: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  const cleaned = raw.replaceAll(/\u00A0|\s|\(|\)|\.|-/g, '').replaceAll(/ext\.?\s*\d+$/gi, '');
  if (!cleaned) return '';

  const candidate = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;

  if (candidate.startsWith('+')) {
    const digits = candidate.slice(1).replaceAll(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return '';
    return `+${digits}`;
  }

  const digits = candidate.replaceAll(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';

  const countryCodeRaw = countryCode ?? getDefaultPhoneCountryCode();
  const fallbackCountryCode = String(countryCodeRaw ?? '').replaceAll(/\D/g, '');

  if (!fallbackCountryCode) throw new Error('DEFAULT_PHONE_COUNTRY_CODE environment variable is not set');
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

  const candidate = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  if (candidate.startsWith('+')) {
    const digits = candidate.slice(1).replaceAll(/\D/g, '');
    return digits.length < 8 || digits.length > 15 ? 'invalid-format' : null;
  }

  const digits = candidate.replaceAll(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return 'invalid-format';

  const countryCodeRaw = getDefaultPhoneCountryCode();
  const fallbackCountryCode = String(countryCodeRaw ?? '').replaceAll(/\D/g, '');

  return fallbackCountryCode ? null : 'missing-default-country-code';
}
