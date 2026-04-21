'use strict';

/**
 * Dashboard-metrics sync service.
 *
 * Computes KPIs from the main DB (leads, integrations) and upserts a
 * single summary row into the Figma Supabase project's `dashboard_metrics`
 * table.  This keeps the Figma Make data binding automatically up-to-date.
 *
 * Can be invoked:
 *   - via POST /api/dashboard/sync  (manual trigger)
 *   - via setInterval on server start (every 5 min)
 */

const { supabaseFigmaAdmin } = require('../config/supabase');
const leadModel = require('../models/lead');
const integrationModel = require('../models/integration');
const credentialModel = require('../models/credential');
const logger = require('../utils/logger');
const { config } = require('../config/env');

const METRICS_ROW_ID = 'nuvanx-main';

/**
 * Sync dashboard metrics for a given user (typically the webhook admin / owner).
 * @param {string} userId — UUID of the admin user whose data populates the KPI row.
 * @returns {{ synced: boolean, metrics?: object }}
 */
async function syncMetrics(userId) {
  if (!supabaseFigmaAdmin) {
    logger.warn('[dashboard-sync] Figma Supabase client not configured — skipping');
    return { synced: false, reason: 'figma_client_unavailable' };
  }

  if (!userId) {
    logger.warn('[dashboard-sync] No userId provided — skipping');
    return { synced: false, reason: 'no_user_id' };
  }

  const [leads, integrations, credentials] = await Promise.all([
    leadModel.findByUser(userId),
    integrationModel.getAll(userId),
    credentialModel.listByUser(userId),
  ]);

  // Only count integrations as "connected" if a real credential exists
  const credentialServices = new Set(credentials.map((c) => c.service));
  const totalLeads = leads.length;
  const totalRevenue = leads.reduce((sum, l) => sum + (l.revenue || 0), 0);
  const connectedIntegrations = integrations.filter(
    (i) => i.status === 'connected' && credentialServices.has(i.service),
  ).length;

  const byStage = {};
  for (const stage of leadModel.STAGES) {
    byStage[stage] = leads.filter((l) => l.stage === stage).length;
  }

  const integrationStatus = (service) => {
    const int = integrations.find((i) => i.service === service);
    return int ? int.status : 'disconnected';
  };

  const row = {
    id: METRICS_ROW_ID,
    total_leads: totalLeads,
    total_revenue: parseFloat(totalRevenue.toFixed(2)),
    connected_integrations: connectedIntegrations,
    total_integrations: integrations.length,
    leads_lead: byStage.lead || 0,
    leads_whatsapp: byStage.whatsapp || 0,
    leads_appointment: byStage.appointment || 0,
    leads_treatment: byStage.treatment || 0,
    leads_closed: byStage.closed || 0,
    meta_status: integrationStatus('meta'),
    whatsapp_status: integrationStatus('whatsapp'),
    github_status: integrationStatus('github'),
    openai_status: integrationStatus('openai'),
    gemini_status: integrationStatus('gemini'),
    last_sync: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseFigmaAdmin
    .from('dashboard_metrics')
    .upsert(row, { onConflict: 'id' });

  if (error) {
    logger.error('[dashboard-sync] Failed to upsert metrics', { error: error.message });
    return { synced: false, reason: error.message };
  }

  logger.info('[dashboard-sync] Metrics synced to Figma project', {
    totalLeads,
    totalRevenue: row.total_revenue,
    connectedIntegrations,
  });
  return { synced: true, metrics: row };
}

/**
 * Start a periodic sync loop (every intervalMs, default 5 min).
 * Uses WEBHOOK_ADMIN_USER_ID as the target user.
 */
let intervalHandle = null;
function startPeriodicSync(intervalMs = 5 * 60 * 1000) {
  const userId = config.webhookAdminUserId;
  if (!userId || !supabaseFigmaAdmin) {
    logger.info('[dashboard-sync] Periodic sync not started — missing userId or Figma client');
    return;
  }

  // Run once immediately, then repeat
  syncMetrics(userId).catch((err) =>
    logger.error('[dashboard-sync] Initial sync failed', { error: err.message })
  );

  intervalHandle = setInterval(() => {
    syncMetrics(userId).catch((err) =>
      logger.error('[dashboard-sync] Periodic sync failed', { error: err.message })
    );
  }, intervalMs);

  logger.info('[dashboard-sync] Periodic sync started', { intervalMs });
}

function stopPeriodicSync() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { syncMetrics, startPeriodicSync, stopPeriodicSync };
