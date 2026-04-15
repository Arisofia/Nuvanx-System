'use strict';

const { pool, isAvailable } = require('../db');
const { supabaseFigmaAdmin } = require('../config/supabase');
const integrationModel = require('../models/integration');
const leadModel = require('../models/lead');
const credentialModel = require('../models/credential');

async function getAuditLog(userId, limit = 100) {
  if (!isAvailable()) return [];
  const { rows } = await pool.query(
    `SELECT action, resource_type, resource_id, metadata, created_at
       FROM audit_log
      WHERE actor_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

async function getUserProfile(userId) {
  if (!isAvailable()) {
    return { id: userId, email: null, name: null };
  }
  const { rows } = await pool.query(
    'SELECT id, email, name, created_at, updated_at FROM users WHERE id = $1 LIMIT 1',
    [userId],
  );
  return rows[0] || { id: userId, email: null, name: null };
}

function buildMetrics(leads, integrations, credentials) {
  const totalLeads = leads.length;
  const totalRevenue = leads.reduce((sum, l) => sum + (l.revenue || 0), 0);
  const stageCounts = leadModel.STAGES.reduce((acc, stage) => {
    acc[stage] = leads.filter((l) => l.stage === stage).length;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    totalLeads,
    totalRevenue: Number(totalRevenue.toFixed(2)),
    connectedIntegrations: integrations.filter((i) => i.status === 'connected').length,
    totalIntegrations: integrations.length,
    totalCredentials: credentials.length,
    stageCounts,
  };
}

async function buildSnapshot(userId) {
  const [user, integrations, leads, credentials, auditLog] = await Promise.all([
    getUserProfile(userId),
    integrationModel.getAll(userId),
    leadModel.findByUser(userId),
    credentialModel.listByUser(userId),
    getAuditLog(userId),
  ]);

  return {
    user,
    metrics: buildMetrics(leads, integrations, credentials),
    integrations,
    leads,
    credentials,
    auditLog,
  };
}

async function publishSnapshotToFigma(userId, snapshot) {
  if (!supabaseFigmaAdmin) {
    throw new Error('Supabase Figma admin client is not configured');
  }

  const now = new Date().toISOString();
  const FILE_KEY = 'uJkwaJl7MIf5DE2VaqV8Vd';

  // 1. Update last_synced on all components for this file
  const { error: compError } = await supabaseFigmaAdmin
    .from('figma_components')
    .update({ last_synced: now })
    .eq('file_key', FILE_KEY);

  if (compError) {
    throw new Error(`Failed to update figma_components: ${compError.message}`);
  }

  // 2. Write a sync log entry with live metrics
  const { data: logRow, error: logError } = await supabaseFigmaAdmin
    .from('figma_sync_log')
    .insert({
      file_key: FILE_KEY,
      status: 'success',
      message: `Live sync: ${snapshot.metrics.totalLeads} leads, ${snapshot.metrics.totalRevenue} revenue, ${snapshot.metrics.connectedIntegrations}/${snapshot.metrics.totalIntegrations} integrations`,
      components_synced: snapshot.metrics.totalIntegrations,
      tokens_synced: snapshot.metrics.totalLeads,
    })
    .select('id, created_at')
    .single();

  if (logError) {
    throw new Error(`Failed to write figma_sync_log: ${logError.message}`);
  }

  return logRow;
}

async function syncUserDataToFigma(userId) {
  const snapshot = await buildSnapshot(userId);
  const command = await publishSnapshotToFigma(userId, snapshot);
  return {
    command,
    metrics: snapshot.metrics,
  };
}

module.exports = {
  syncUserDataToFigma,
};
