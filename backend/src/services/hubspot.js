'use strict';

const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');
const { config } = require('../config/env');

const HUBSPOT_BASE = 'https://api.hubapi.com';
const PAK_REFRESH_URL = 'https://api.hubspot.com/localdevauth/v1/auth/refresh';
// Refresh 5 minutes before expiry to avoid using a nearly-expired token
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** In-memory token cache — refreshed automatically from the PAK */
let _cachedToken = null;      // string
let _tokenExpiresAt = 0;      // epoch ms
let _refreshPromise = null;   // deduplicate concurrent refresh requests

/**
 * Exchange the Personal Access Key (PAK) for a short-lived OAuth access token.
 * PAK itself never expires; tokens last ~30 minutes.
 * Endpoint discovered from HubSpot CLI source: @hubspot/local-dev-lib.
 */
async function _refreshTokenFromPak() {
  const pak = config.hubspotPak;
  const portalId = config.hubspotPortalId;
  if (!pak) throw new Error('HUBSPOT_PAK not set — cannot auto-refresh token');

  const { data } = await axios.post(
    PAK_REFRESH_URL + (portalId ? `?portalId=${portalId}` : ''),
    { encodedOAuthRefreshToken: pak },
    { timeout: 10000 },
  );
  _cachedToken = data.oauthAccessToken;
  _tokenExpiresAt = data.expiresAtMillis;
  logger.info('HubSpot token refreshed via PAK', {
    expiresAt: new Date(_tokenExpiresAt).toISOString(),
  });
  return _cachedToken;
}

/**
 * Return a valid access token, refreshing via PAK when needed.
 * Falls back to HUBSPOT_ACCESS_TOKEN env var if no PAK is configured.
 * @returns {Promise<string>} Valid access token
 */
async function _getToken() {
  const pak = config.hubspotPak;

  // No PAK — use static token from env (may be stale)
  if (!pak) {
    const staticToken = config.hubspotAccessToken;
    if (!staticToken) throw new Error('Neither HUBSPOT_PAK nor HUBSPOT_ACCESS_TOKEN is set');
    return staticToken;
  }

  // Token still valid
  if (_cachedToken && Date.now() + REFRESH_BUFFER_MS < _tokenExpiresAt) {
    return _cachedToken;
  }

  // Deduplicate concurrent refresh requests
  if (!_refreshPromise) {
    _refreshPromise = _refreshTokenFromPak().finally(() => { _refreshPromise = null; });
  }
  return _refreshPromise;
}

/**
 * Build Axios request config for HubSpot.
 * Uses Bearer token authentication (Private App access tokens).
 * Legacy hapikey auth was deprecated by HubSpot on 2022-11-30.
 * @param {string} [credential]  Token override; auto-refreshed from PAK if omitted
 */
async function _authConfigAsync(credential) {
  const token = credential || await _getToken();
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

// Synchronous variant kept for paths that already have a credential param
function _authConfig(credential) {
  return { headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' } };
}

/**
 * Verify a HubSpot credential by fetching the account details.
 * Omit credential to let the PAK auto-refresh token handle authentication.
 * @param {string} [credential]  Access token override
 * @returns {{ connected: boolean, portalId?: number, accountName?: string, error?: string }}
 */
async function testConnection(credential) {
  try {
    const authCfg = await _authConfigAsync(credential);
    const { data } = await axios.get(`${HUBSPOT_BASE}/account-info/v3/details`, {
      ...authCfg,
      timeout: 10000,
    });
    return { connected: true, portalId: data.portalId, accountName: data.companyDomain };
  } catch (err) {
    const message = err.response?.data?.message || err.message;
    logger.warn('HubSpot testConnection failed', { error: message });
    return { connected: false, error: message };
  }
}

/**
 * Fetch a page of HubSpot CRM contacts.
 * @param {string} credential
 * @param {number} [limit=50]
 * @returns {object[]} Array of HubSpot contact objects
 */
async function getContacts(credential, limit = 50) {
  const authCfg = await _authConfigAsync(credential);
  const { data } = await axios.get(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
    ...authCfg,
    params: { ...authCfg.params, limit, properties: 'firstname,lastname,email,phone,lifecyclestage' },
    timeout: 15000,
  });
  return data.results || [];
}

/**
 * Create a new contact in HubSpot CRM.
 * @param {string} credential
 * @param {{ email: string, firstname?: string, lastname?: string, phone?: string }} contactData
 * @returns {object} Created contact resource
 */
async function createContact(credential, contactData) {
  const authCfg = _authConfig(credential);
  const { data } = await axios.post(
    `${HUBSPOT_BASE}/crm/v3/objects/contacts`,
    { properties: contactData },
    { ...authCfg, timeout: 15000 },
  );
  return data;
}

/**
 * Create or update a deal in HubSpot CRM.
 * @param {string} credential
 * @param {{ dealname: string, amount?: number, dealstage?: string, closedate?: string }} dealData
 * @returns {object} Created deal resource
 */
async function createDeal(credential, dealData) {
  const authCfg = _authConfig(credential);
  const { data } = await axios.post(
    `${HUBSPOT_BASE}/crm/v3/objects/deals`,
    { properties: dealData },
    { ...authCfg, timeout: 15000 },
  );
  return data;
}

/**
 * Fetch analytics/trends from HubSpot CRM.
 * Returns aggregated metrics for contacts, deals, and revenue over time.
 * @param {string} credential
 * @param {{ since?: string, until?: string }} dateRange ISO date strings
 * @returns {Promise<object>} Trends data with metrics over time
 */
async function getTrends(credential, dateRange = {}) {
  const authCfg = _authConfig(credential);

  // Fetch recent contacts with creation dates
  const contactsRes = await axios.get(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
    ...authCfg,
    params: {
      ...authCfg.params,
      limit: 500,
      properties: 'firstname,lastname,email,createdate,lifecyclestage',
    },
    timeout: 15000,
  });

  // Fetch recent deals with creation dates and amounts
  const dealsRes = await axios.get(`${HUBSPOT_BASE}/crm/v3/objects/deals`, {
    ...authCfg,
    params: {
      ...authCfg.params,
      limit: 500,
      properties: 'dealname,amount,dealstage,createdate,closedate',
    },
    timeout: 15000,
  });

  const contacts = contactsRes.data?.results || [];
  const deals = dealsRes.data?.results || [];

  // Group by date for trends
  const trendsMap = {};

  contacts.forEach(contact => {
    const date = contact.properties?.createdate?.split('T')[0];
    if (!date) return;
    if (!trendsMap[date]) trendsMap[date] = { date, contacts: 0, deals: 0, revenue: 0 };
    trendsMap[date].contacts++;
  });

  deals.forEach(deal => {
    const date = deal.properties?.createdate?.split('T')[0];
    const amount = parseFloat(deal.properties?.amount || 0);
    if (!date) return;
    if (!trendsMap[date]) trendsMap[date] = { date, contacts: 0, deals: 0, revenue: 0 };
    trendsMap[date].deals++;
    trendsMap[date].revenue += amount;
  });

  const trends = Object.values(trendsMap).sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalContacts: contacts.length,
    totalDeals: deals.length,
    totalRevenue: deals.reduce((sum, d) => sum + parseFloat(d.properties?.amount || 0), 0),
    trends,
  };
}

// ── Lifecycle stage → internal lead stage mapping ─────────────────────────
const STAGE_MAP = {
  subscriber: 'lead',
  lead: 'lead',
  marketingqualifiedlead: 'lead',
  salesqualifiedlead: 'whatsapp',
  opportunity: 'appointment',
  customer: 'treatment',
  evangelist: 'closed',
};

/**
 * Map a single HubSpot contact object to the internal lead schema.
 * @param {object} contact  HubSpot contact result (from CRM v3 objects)
 * @returns {object} Partial lead data ready for create/update
 */
function mapContactToLead(contact) {
  const p = contact.properties || {};
  const name =
    [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || 'HubSpot Contact';
  const lifecycle = (p.lifecyclestage || '').toLowerCase().replace(/\s/g, '');
  return {
    name,
    email: p.email || '',
    phone: p.phone || '',
    source: 'hubspot',
    stage: STAGE_MAP[lifecycle] || 'lead',
    revenue: 0,
    notes: `HubSpot ID: ${contact.id}`,
  };
}

/**
 * Verify a HubSpot webhook request signature (v1 — HMAC-SHA256).
 * HubSpot sends: X-HubSpot-Signature = hex(HMAC-SHA256(clientSecret + rawBody))
 * @param {string} clientSecret  HUBSPOT_CLIENT_SECRET env var
 * @param {string|Buffer} rawBody  Raw request body string
 * @param {string} signature  Value of X-HubSpot-Signature header
 * @returns {boolean}
 */
function verifyWebhookSignature(clientSecret, rawBody, signature) {
  if (!clientSecret || !signature) return false;
  const expected = crypto
    .createHmac('sha256', clientSecret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Fetch HubSpot contacts and return them mapped to internal lead objects.
 * Up to 100 contacts, newest first.
 * @param {string} credential  Private App access token
 * @returns {{ leads: object[], total: number }}
 */
async function fetchLeadsFromHubSpot(credential) {
  const authCfg = await _authConfigAsync(credential);
  const { data } = await axios.get(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
    ...authCfg,
    params: {
      limit: 100,
      properties: 'firstname,lastname,email,phone,lifecyclestage,createdate',
    },
    timeout: 20000,
  });
  const results = data.results || [];
  return { leads: results.map(mapContactToLead), total: results.length };
}

module.exports = {
  testConnection,
  getContacts,
  createContact,
  createDeal,
  getTrends,
  mapContactToLead,
  verifyWebhookSignature,
  fetchLeadsFromHubSpot,
  // Exposed for testing / forced refresh
  refreshToken: _refreshTokenFromPak,
};
