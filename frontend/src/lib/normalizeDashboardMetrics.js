function pickNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Accepts dashboard metrics payloads in either shape:
 * 1) { metrics: { totalLeads, ... } }
 * 2) { total_leads, ... } or { totalLeads, ... }
 */
export function normalizeDashboardMetrics(payload) {
  const source = pickObject(payload?.metrics || payload);

  const byStageRaw = source.byStage || source.by_stage;
  const bySourceRaw = source.bySource || source.by_source;

  return {
    totalLeads: pickNumber(source.totalLeads ?? source.total_leads, 0),
    totalRevenue: pickNumber(source.totalRevenue ?? source.total_revenue, 0),
    verifiedRevenue: pickNumber(source.verifiedRevenue ?? source.verified_revenue, 0),
    settledCount: pickNumber(source.settledCount ?? source.settled_count, 0),
    conversions: pickNumber(source.conversions, 0),
    conversionRate: pickNumber(source.conversionRate ?? source.conversion_rate, 0),
    connectedIntegrations: pickNumber(source.connectedIntegrations ?? source.connected_integrations, 0),
    totalIntegrations: pickNumber(source.totalIntegrations ?? source.total_integrations, 0),
    byStage: pickObject(byStageRaw),
    bySource: pickObject(bySourceRaw),
  };
}
