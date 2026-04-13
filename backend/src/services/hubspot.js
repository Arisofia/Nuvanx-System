'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const HUBSPOT_BASE = 'https://api.hubapi.com';

/**
 * Build Axios request config for HubSpot.
 * Supports both Private App access tokens (Bearer) and legacy API keys (hapikey).
 * @param {string} credential  Access token (starts with "pat-") or legacy API key
 */
function _authConfig(credential) {
  if (credential.startsWith('pat-') || credential.length > 40) {
    // Private App access token
    return { headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' } };
  }
  // Legacy hapikey (deprecated but still supported)
  return { params: { hapikey: credential }, headers: { 'Content-Type': 'application/json' } };
}

/**
 * Verify a HubSpot credential by fetching the account details.
 * @param {string} credential  Access token or API key
 * @returns {{ connected: boolean, portalId?: number, accountName?: string, error?: string }}
 */
async function testConnection(credential) {
  try {
    const authCfg = _authConfig(credential);
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
  const authCfg = _authConfig(credential);
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

module.exports = { testConnection, getContacts, createContact, createDeal, getTrends };
