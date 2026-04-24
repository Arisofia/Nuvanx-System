'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { normalizePhoneToE164 } = require('../utils/phone');

const WA_BASE = 'https://graph.facebook.com/v21.0';

/**
 * Test the WhatsApp Business Cloud API connection.
 * @param {string} accessToken
 * @param {string} phoneNumberId
 * @returns {{ connected: boolean, displayPhoneNumber?: string, error?: string }}
 */
async function testConnection(accessToken, phoneNumberId) {
  if (!/^\d{10,20}$/.test(phoneNumberId)) {
    return { connected: false, error: 'Invalid phoneNumberId format' };
  }
  try {
    const { data } = await axios.get(`${WA_BASE}/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { fields: 'display_phone_number,verified_name,quality_rating' },
      timeout: 10000,
    });
    return { connected: true, displayPhoneNumber: data.display_phone_number, verifiedName: data.verified_name };
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message;
    logger.warn('WhatsApp testConnection failed', { error: message });
    return { connected: false, error: message };
  }
}

/**
 * Send a WhatsApp text message.
 * @param {string} accessToken
 * @param {string} phoneNumberId  Sender's phone number ID
 * @param {string} to             Recipient phone number (E.164 format)
 * @param {string} message
 */
async function sendMessage(accessToken, phoneNumberId, to, message) {
  if (!/^\d{10,20}$/.test(phoneNumberId)) {
    throw new Error('Invalid phoneNumberId format');
  }
  const normalizedTo = normalizePhoneToE164(to);
  if (!normalizedTo) {
    throw new Error('Invalid recipient phone number format');
  }
  const recipient = normalizedTo.slice(1); // WhatsApp Cloud API expects international number without leading +

  const { data } = await axios.post(
    `${WA_BASE}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { preview_url: false, body: message },
    },
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    },
  );
  return data;
}

/**
 * Send a WhatsApp template message.
 * @param {string} accessToken
 * @param {string} phoneNumberId
 * @param {string} to
 * @param {string} templateName
 * @param {string} languageCode
 * @param {Array}  components    Template variable components
 */
async function sendTemplateMessage(accessToken, phoneNumberId, to, templateName, languageCode = 'es', components = []) {
  if (!/^\d{10,20}$/.test(phoneNumberId)) {
    throw new Error('Invalid phoneNumberId format');
  }
  const { data } = await axios.post(
    `${WA_BASE}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    },
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    },
  );
  return data;
}

/**
 * Discover all WhatsApp phone numbers registered under the business associated
 * with the given access token.
 *
 * Flow: /me/businesses → owned_whatsapp_business_accounts → phone_numbers
 *
 * @param {string} accessToken  Meta System User or Page access token
 * @returns {Array<{ id: string, display_phone_number: string, verified_name: string, waba_id: string }>}
 */
async function discoverPhoneNumbers(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // 1. Fetch businesses for this token
  const meRes = await axios.get(`${WA_BASE}/me/businesses`, {
    headers,
    params: { fields: 'id,name' },
    timeout: 10000,
  });
  const businesses = meRes.data.data || [];
  if (businesses.length === 0) {
    return [];
  }

  const allPhoneNumbers = [];

  for (const biz of businesses) {
    // 2. Fetch WhatsApp Business Accounts owned by this business
    let wabaList = [];
    try {
      const wabaRes = await axios.get(`${WA_BASE}/${biz.id}/owned_whatsapp_business_accounts`, {
        headers,
        params: { fields: 'id,name' },
        timeout: 10000,
      });
      wabaList = wabaRes.data.data || [];
    } catch (err) {
      logger.warn('discoverPhoneNumbers: could not fetch WABAs for business', { bizId: biz.id, error: err.message });
      continue;
    }

    for (const waba of wabaList) {
      // 3. Fetch phone numbers for this WABA
      try {
        const pnRes = await axios.get(`${WA_BASE}/${waba.id}/phone_numbers`, {
          headers,
          params: { fields: 'id,display_phone_number,verified_name,quality_rating' },
          timeout: 10000,
        });
        const numbers = (pnRes.data.data || []).map((pn) => ({ ...pn, waba_id: waba.id }));
        allPhoneNumbers.push(...numbers);
      } catch (err) {
        logger.warn('discoverPhoneNumbers: could not fetch phone numbers for WABA', { wabaId: waba.id, error: err.message });
      }
    }
  }

  return allPhoneNumbers;
}

module.exports = { testConnection, sendMessage, sendTemplateMessage, discoverPhoneNumbers };
