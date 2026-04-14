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

  const commandPayload = {
    user_id: userId,
    command_type: 'figma_data_sync',
    status: 'completed',
    payload: snapshot,
    result: {
      syncedAt: new Date().toISOString(),
      leadCount: snapshot.leads.length,
      integrationCount: snapshot.integrations.length,
      credentialCount: snapshot.credentials.length,
      auditLogCount: snapshot.auditLog.length,
    },
  };

  const { data: commandRow, error: commandError } = await supabaseFigmaAdmin
    .schema('monitoring')
    .from('commands')
    .insert(commandPayload)
    .select('id, created_at')
    .single();

  if (commandError) {
    throw new Error(`Failed to write monitoring.commands: ${commandError.message}`);
  }

  const { error: eventError } = await supabaseFigmaAdmin
    .schema('monitoring')
    .from('operational_events')
    .insert({
      user_id: userId,
      event_type: 'figma_sync',
      message: 'Real Supabase snapshot synced for Figma consumption',
      metadata: {
        commandId: commandRow.id,
        syncedAt: new Date().toISOString(),
      },
    });

  if (eventError) {
    throw new Error(`Failed to write monitoring.operational_events: ${eventError.message}`);
  }

  return commandRow;
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
