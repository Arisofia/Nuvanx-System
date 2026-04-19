'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

function normalizeAdAccountId(adAccountId) {
  const raw = String(adAccountId || '').trim();
  const normalized = raw.startsWith('act_') ? raw : `act_${raw}`;
  // Meta ad account ids are numeric, optionally prefixed with act_.
  if (!/^act_\d{5,30}$/.test(normalized)) {
    throw new Error('Invalid Meta ad account id');
  }
  return normalized;
}

/**
 * Test a Meta Marketing API access token.
 * @param {string} accessToken
 * @returns {{ connected: boolean, accountName?: string, error?: string }}
 */
async function testConnection(accessToken) {
  try {
    const { data } = await axios.get(`${META_GRAPH_BASE}/me`, {
      params: { access_token: accessToken, fields: 'id,name' },
      timeout: 10000,
    });
    return { connected: true, accountName: data.name };
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message;
    logger.warn('Meta testConnection failed', { error: message });
    return { connected: false, error: message };
  }
}

/**
 * Fetch ad campaigns for the authenticated account.
 * @param {string} accessToken
 * @param {string} adAccountId  e.g. "act_123456789"
 */
async function getCampaigns(accessToken, adAccountId) {
  const safeAdAccountId = normalizeAdAccountId(adAccountId);
  const { data } = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(safeAdAccountId)}/campaigns`, {
    params: {
      access_token: accessToken,
      fields: 'id,name,status,objective,daily_budget,lifetime_budget',
      limit: 50,
    },
    timeout: 15000,
  });
  return data.data || [];
}

/**
 * Fetch ad insight metrics for the authenticated account.
 * @param {string} accessToken
 * @param {string} adAccountId
 * @param {{ since: string, until: string }} dateRange  ISO date strings
 */
async function getMetrics(accessToken, adAccountId, dateRange = {}) {
  const safeAdAccountId = normalizeAdAccountId(adAccountId);
  const params = {
    access_token: accessToken,
    fields: 'impressions,reach,clicks,spend,cpc,cpm,ctr,conversions',
    time_range: JSON.stringify({
      since: dateRange.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      until: dateRange.until || new Date().toISOString().slice(0, 10),
    }),
  };
  const { data } = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(safeAdAccountId)}/insights`, {
    params,
    timeout: 15000,
  });
  return data.data || [];
}

/**
 * Fetch comprehensive Meta ad insights with all available metrics.
 * @param {string} accessToken
 * @param {string} adAccountId
 * @param {{ since: string, until: string }} dateRange  ISO date strings
 * @returns {Promise<object[]>} Array of insight objects with full metrics
 */
async function getComprehensiveMetrics(accessToken, adAccountId, dateRange = {}) {
  const safeAdAccountId = normalizeAdAccountId(adAccountId);
  const params = {
    access_token: accessToken,
    fields: [
      'impressions',
      'reach',
      'clicks',
      'spend',
      'cpc',
      'cpm',
      'ctr',
      'cpp',
      'frequency',
      'conversions',
      'cost_per_conversion',
      'conversion_rate_ranking',
      'quality_ranking',
      'engagement_rate_ranking',
      'actions',
      'action_values',
      'cost_per_action_type',
      'video_30_sec_watched_actions',
      'video_p25_watched_actions',
      'video_p50_watched_actions',
      'video_p75_watched_actions',
      'video_p100_watched_actions',
      'link_clicks',
      'outbound_clicks',
      'unique_clicks',
      'unique_link_clicks_ctr',
      'website_ctr',
    ].join(','),
    time_range: JSON.stringify({
      since: dateRange.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      until: dateRange.until || new Date().toISOString().slice(0, 10),
    }),
    time_increment: 1, // Daily breakdown
    limit: 1000,
  };
  const { data } = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(safeAdAccountId)}/insights`, {
    params,
    timeout: 30000,
  });
  return data.data || [];
}

/**
 * Fetch time series data for trend analysis (daily breakdown).
 * @param {string} accessToken
 * @param {string} adAccountId
 * @param {{ since: string, until: string }} dateRange
 * @returns {Promise<object[]>} Daily metrics array
 */
async function getTrendsData(accessToken, adAccountId, dateRange = {}) {
  const safeAdAccountId = normalizeAdAccountId(adAccountId);
  const defaultSince = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const params = {
    access_token: accessToken,
    fields: 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,actions',
    time_range: JSON.stringify({
      since: dateRange.since || defaultSince,
      until: dateRange.until || new Date().toISOString().slice(0, 10),
    }),
    time_increment: 1,
    limit: 1000,
  };
  const { data } = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(safeAdAccountId)}/insights`, {
    params,
    timeout: 30000,
  });
  return data.data || [];
}

/**
 * Fetch campaigns with per-campaign insights in a single API call.
 * Uses the insights edge with a time_range filter so each campaign row
 * includes spend, impressions, clicks, reach, CTR, CPC, CPM, CPP, and
 * conversions for the requested date window.
 *
 * @param {string} accessToken
 * @param {string} adAccountId
 * @param {{ since: string, until: string }} dateRange  ISO date strings
 * @returns {Promise<object[]>}
 */
async function getCampaignsWithInsights(accessToken, adAccountId, dateRange = {}) {
  const safeAdAccountId = normalizeAdAccountId(adAccountId);
  const since = dateRange.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const until = dateRange.until || new Date().toISOString().slice(0, 10);

  const { data } = await axios.get(`${META_GRAPH_BASE}/${encodeURIComponent(safeAdAccountId)}/campaigns`, {
    params: {
      access_token: accessToken,
      fields: 'id,name,status,objective,daily_budget,lifetime_budget,' +
              'insights{spend,impressions,reach,clicks,ctr,cpc,cpm,cpp,conversions}',
      time_range: JSON.stringify({ since, until }),
      limit: 50,
    },
    timeout: 30000,
  });

  const campaigns = data.data || [];
  return campaigns.map((c) => {
    const ins = c.insights?.data?.[0] ?? null;
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      daily_budget: c.daily_budget,
      lifetime_budget: c.lifetime_budget,
      insights: ins
        ? {
            spend: parseFloat(ins.spend || 0),
            impressions: parseFloat(ins.impressions || 0),
            reach: parseFloat(ins.reach || 0),
            clicks: parseFloat(ins.clicks || 0),
            ctr: parseFloat(ins.ctr || 0),
            cpc: parseFloat(ins.cpc || 0),
            cpm: parseFloat(ins.cpm || 0),
            cpp: parseFloat(ins.cpp || 0),
            conversions: parseFloat(ins.conversions || 0),
          }
        : null,
    };
  });
}

module.exports = { testConnection, getCampaigns, getCampaignsWithInsights, getMetrics, getComprehensiveMetrics, getTrendsData };
