'use strict';

const { pool, isAvailable } = require('../db');
const { supabaseAdmin, supabaseFigmaAdmin } = require('../config/supabase');
const integrationModel = require('../models/integration');
const leadModel = require('../models/lead');
const credentialModel = require('../models/credential');
const githubService = require('./github');
const { config } = require('../config/env');

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

const GITHUB_STATS_REPO_LIMIT = 30;

async function getGitHubStats(userId, credentials) {
  const ghCredential = credentials.find((c) => c.service === 'github');
  const token = ghCredential ? await credentialModel.getDecryptedKey(userId, 'github') : null;
  const effectiveToken = token || config.githubToken;
  if (!effectiveToken) return null;

  try {
    const repos = await githubService.listRepositories(effectiveToken, { perPage: GITHUB_STATS_REPO_LIMIT });
    return {
      repoCount: repos.length,
      repos: repos.slice(0, 5).map((r) => ({
        name: r.full_name,
        language: r.language,
        openIssues: r.open_issues_count,
        updatedAt: r.updated_at,
      })),
    };
  } catch {
    return null;
  }
}

async function buildSnapshot(userId) {
  const [user, integrations, leads, credentials, auditLog] = await Promise.all([
    getUserProfile(userId),
    integrationModel.getAll(userId),
    leadModel.findByUser(userId),
    credentialModel.listByUser(userId),
    getAuditLog(userId),
  ]);

  const githubStats = await getGitHubStats(userId, credentials);

  return {
    user,
    metrics: buildMetrics(leads, integrations, credentials),
    integrations,
    leads,
    credentials,
    auditLog,
    ...(githubStats && { githubStats }),
  };
}

async function publishSnapshotToFigma(userId, snapshot) {
  if (!supabaseFigmaAdmin) {
    throw new Error('Supabase Figma admin client is not configured');
  }

  const now = new Date().toISOString();
  const FILE_KEY = 'uJkwaJl7MIf5DE2VaqV8Vd';
  const { metrics, integrations } = snapshot;

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
      message: `Live sync: ${metrics.totalLeads} leads, ${metrics.totalRevenue} revenue, ${metrics.connectedIntegrations}/${metrics.totalIntegrations} integrations`,
      components_synced: metrics.totalIntegrations,
      tokens_synced: metrics.totalLeads,
    })
    .select('id, created_at')
    .single();

  if (logError) {
    throw new Error(`Failed to write figma_sync_log: ${logError.message}`);
  }

  // 3a. Refresh KPI rows in design_tokens (works immediately — no DDL needed)
  const statusOf = (svc) => {
    const found = integrations.find((i) => i.service === svc);
    return found ? found.status : 'disconnected';
  };

  const kpiRows = [
    { file_key: FILE_KEY, token_type: 'kpi', name: 'total_leads',            value: String(metrics.totalLeads),            code_location: null, metadata: { label: 'Total Leads', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'total_revenue',           value: String(metrics.totalRevenue),           code_location: null, metadata: { label: 'Total Revenue (EUR)', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'connected_integrations',  value: String(metrics.connectedIntegrations),  code_location: null, metadata: { label: 'Connected Integrations', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'total_integrations',      value: String(metrics.totalIntegrations),      code_location: null, metadata: { label: 'Total Integrations', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'leads_lead',              value: String(metrics.stageCounts?.lead ?? 0), code_location: null, metadata: { label: 'Stage: Lead', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'leads_whatsapp',          value: String(metrics.stageCounts?.whatsapp ?? 0), code_location: null, metadata: { label: 'Stage: WhatsApp', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'leads_appointment',       value: String(metrics.stageCounts?.appointment ?? 0), code_location: null, metadata: { label: 'Stage: Appointment', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'leads_treatment',         value: String(metrics.stageCounts?.treatment ?? 0), code_location: null, metadata: { label: 'Stage: Treatment', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'leads_closed',            value: String(metrics.stageCounts?.closed ?? 0), code_location: null, metadata: { label: 'Stage: Closed', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'hubspot_status',          value: statusOf('hubspot'),  code_location: null, metadata: { label: 'HubSpot Status', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'meta_status',             value: statusOf('meta'),     code_location: null, metadata: { label: 'Meta Status', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'whatsapp_status',         value: statusOf('whatsapp'), code_location: null, metadata: { label: 'WhatsApp Status', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'github_status',           value: statusOf('github'),   code_location: null, metadata: { label: 'GitHub Status', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'openai_status',           value: statusOf('openai'),   code_location: null, metadata: { label: 'OpenAI Status', synced_at: now } },
    { file_key: FILE_KEY, token_type: 'kpi', name: 'gemini_status',           value: statusOf('gemini'),   code_location: null, metadata: { label: 'Gemini Status', synced_at: now } },
  ];

  // Replace previous KPI tokens with fresh values
  const { error: delErr } = await supabaseFigmaAdmin
    .from('design_tokens')
    .delete()
    .eq('file_key', FILE_KEY)
    .eq('token_type', 'kpi');
  if (!delErr) {
    await supabaseFigmaAdmin.from('design_tokens').insert(kpiRows);
  }

  // 3b. Upsert flat KPI row to nuvanx-prod dashboard_metrics (primary — always works)
  const kpiPayload = {
    id: 'nuvanx-main',
    label: 'Nuvanx KPIs',
    total_leads: metrics.totalLeads,
    total_revenue: metrics.totalRevenue,
    connected_integrations: metrics.connectedIntegrations,
    total_integrations: metrics.totalIntegrations,
    leads_lead: metrics.stageCounts?.lead ?? 0,
    leads_whatsapp: metrics.stageCounts?.whatsapp ?? 0,
    leads_appointment: metrics.stageCounts?.appointment ?? 0,
    leads_treatment: metrics.stageCounts?.treatment ?? 0,
    leads_closed: metrics.stageCounts?.closed ?? 0,
    hubspot_status: statusOf('hubspot'),
    meta_status: statusOf('meta'),
    whatsapp_status: statusOf('whatsapp'),
    github_status: statusOf('github'),
    openai_status: statusOf('openai'),
    gemini_status: statusOf('gemini'),
    last_sync: now,
    updated_at: now,
  };

  if (supabaseAdmin) {
    const { error } = await supabaseAdmin
      .from('dashboard_metrics')
      .upsert(kpiPayload, { onConflict: 'id' });
    if (error) {
      const logger = require('../utils/logger');
      logger.warn('dashboard_metrics upsert failed', { hint: error.message });
    }
  }

  // 3c. Best-effort mirror to legacy Figma project (zpowfbeftxexzidlxndy).
  //     Silently skipped — frontend now reads from nuvanx-prod directly.
  if (supabaseFigmaAdmin) {
    supabaseFigmaAdmin
      .from('dashboard_metrics')
      .upsert(kpiPayload, { onConflict: 'id' })
      .then(() => { /* best-effort, ignore errors */ })
      .catch(() => { /* project may not have this table */ });
  }

  // 4. Write operational event to monitoring schema (best-effort — schema may not exist)
  await supabaseFigmaAdmin
    .schema('monitoring')
    .from('operational_events')
    .insert({
      user_id: userId,
      event_type: 'figma_sync',
      message: snapshot.githubStats
        ? `Supabase snapshot synced: ${snapshot.leads.length} leads, ${snapshot.githubStats.repoCount} GitHub repos`
        : `Supabase snapshot synced: ${snapshot.leads.length} leads, ${integrations.length} integrations`,
      metadata: {
        syncedAt: now,
        ...(snapshot.githubStats && { githubStats: snapshot.githubStats }),
      },
    })
    .then(({ error }) => {
      if (error) {
        const logger = require('../utils/logger');
        logger.warn('monitoring.operational_events write skipped', { error: error.message });
      }
    });

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
