// shared/capi.ts
// Mapea un payload de lead a un evento CAPI para Meta

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
  if (stage === 'whatsapp' || source.includes('whatsapp') || stage === 'messaging_conversation_started') {
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
