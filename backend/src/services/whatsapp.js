'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

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
  const { data } = await axios.post(
    `${WA_BASE}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
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

module.exports = { testConnection, sendMessage, sendTemplateMessage };
