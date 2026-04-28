import { normalizePhoneForMeta } from './phone.ts';

export async function sha256Hex(input: string): Promise<string> {
  const normalized = String(input ?? '').trim().toLowerCase();
  if (!normalized) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deriveCapiExternalId({
  phone = '',
  email = '',
}: {
  phone?: string;
  email?: string;
}): Promise<string> {
  const normalizedPhone = normalizePhoneForMeta(phone);
  if (normalizedPhone) return sha256Hex(normalizedPhone);
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  return normalizedEmail ? sha256Hex(normalizedEmail) : '';
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
