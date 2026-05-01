import { normalizePhoneForMeta } from './phone.ts';

export async function sha256Hex(input: string): Promise<string> {
  const normalized = String(input ?? '').trim().toLowerCase();
  if (!normalized) return '';

  // Prefer Web Crypto if available (browsers, modern Node). Fallback to Node's crypto module when needed.
  if (typeof crypto !== 'undefined' && typeof (crypto as any).subtle !== 'undefined') {
    const digest = await (crypto as any).subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for Node environments without Web Crypto (dynamic import to keep ESM compatibility)
  try {
    const nodeCrypto = await import('crypto');
    return nodeCrypto.createHash('sha256').update(normalized).digest('hex');
  } catch (err) {
    // If neither is available, fail gracefully with empty string
    console.warn('[sha256Hex] No crypto available to compute hash:', err?.message || err);
    return '';
  }
}

export async function deriveCapiExternalId({
  phone = '',
  email = '',
}: {
  phone?: string;
  email?: string;
}): Promise<string> {
  const normalizedPhone = normalizePhoneForMeta(phone);
  if (normalizedPhone) return await sha256Hex(normalizedPhone);
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  return normalizedEmail ? await sha256Hex(normalizedEmail) : '';
}

export function mapLeadPayloadToCapiEvent(payload: any): {
  eventName: string;
  value?: number;
  customData?: Record<string, unknown>;
} {
  const stage = String(payload?.stage ?? '').toLowerCase();
  const source = String(payload?.source ?? '').toLowerCase();
  const revenue = Number(payload?.revenue ?? 0);
  const isQualified = payload?.lead_quality === 'qualified' || payload?.is_qualified === true;
  const attended = payload?.status === 'attended' || payload?.appointment_status === 'attended';

  // Incluye el nuevo evento messaging_conversation_started mapeado como 'Contact'
  if (stage === 'whatsapp' || source.includes('whatsapp') || stage === 'messaging_conversation_started' || source.includes('messaging_conversation_started')) {
    return { eventName: 'Contact' };
  }
  if (isQualified) {
    return { eventName: 'Lead', customData: { lead_quality: 'qualified' } };
  }
  if (stage === 'appointment') {
    return { eventName: 'Schedule', customData: attended ? { status: 'attended' } : {} };
  }
  if (stage === 'treatment' || stage === 'closed') {
    if (revenue > 1500) {
      return { eventName: 'Purchase', value: revenue, customData: { content_category: 'premium' } };
    }
    return { eventName: 'Purchase', value: revenue };
  }
  return { eventName: 'Lead' };
}
