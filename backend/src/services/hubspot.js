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

module.exports = { testConnection, getContacts, createContact, createDeal };
