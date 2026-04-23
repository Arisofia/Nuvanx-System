// shared/capi.ts
// Mapea un payload de lead a un evento CAPI
export function mapLeadPayloadToCapiEvent(payload: any) {
  // Implementación de ejemplo, ajustar según necesidades reales
  return {
    event_name: payload.event || 'lead',
    event_time: payload.timestamp || Date.now(),
    user_data: {
      phone: payload.phone,
      email: payload.email,
      external_id: payload.external_id,
    },
    custom_data: payload.custom_data || {},
  };
}
