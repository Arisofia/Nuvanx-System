'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

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
  const { data } = await axios.get(`${META_GRAPH_BASE}/${adAccountId}/campaigns`, {
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
  const params = {
    access_token: accessToken,
    fields: 'impressions,reach,clicks,spend,cpc,cpm,ctr,conversions',
    time_range: JSON.stringify({
      since: dateRange.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      until: dateRange.until || new Date().toISOString().slice(0, 10),
    }),
  };
  const { data } = await axios.get(`${META_GRAPH_BASE}/${adAccountId}/insights`, {
    params,
    timeout: 15000,
  });
  return data.data || [];
}

module.exports = { testConnection, getCampaigns, getMetrics };
