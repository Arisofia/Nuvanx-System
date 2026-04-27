'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { config } = require('../config/env');
const logger = require('../utils/logger');
const { normalizePhoneForMeta } = require('../utils/phone');

const META_GRAPH_VERSION = 'v21.0';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function buildExternalIdFromPhone(phone) {
  const normalizedPhone = normalizePhoneForMeta(phone);
  if (!normalizedPhone) return null;
  return sha256(normalizedPhone);
}

function deriveCapiExternalId({ phone = '', email = '' }) {
  const phoneExternalId = buildExternalIdFromPhone(phone);
  if (phoneExternalId) return phoneExternalId;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;
  return sha256(normalizedEmail);
}

function mapLeadPayloadToCapiEvent(payload = {}) {
  const stage = String(payload.stage || '').toLowerCase();
  const source = String(payload.source || '').toLowerCase();
  const revenue = Number(payload.revenue || 0);
  const isQualified = payload.lead_quality === 'qualified' || payload.is_qualified === true;
  const attended = payload.status === 'attended' || payload.appointment_status === 'attended';

  if (stage === 'whatsapp' || source.includes('whatsapp') || source.includes('messaging_conversation_started')) {
    return { eventName: 'Contact' };
  }
  if (isQualified) {
    return { eventName: 'Lead', customData: { lead_quality: 'qualified' } };
  }
  if (stage === 'appointment') {
    return { eventName: 'Schedule', customData: attended ? { status: 'attended' } : {} };
  }
  if (stage === 'treatment' || stage === 'closed') {
    if (revenue > 1500) {
      return { eventName: 'Purchase', value: revenue, customData: { content_category: 'premium' } };
    }
    return { eventName: 'Purchase', value: revenue };
  }
  return { eventName: 'Lead' };
}

async function sendMetaCapiEvent({
  eventName,
  eventTime,
  phone,
  email,
  externalId,
  eventSourceUrl,
  actionSource = 'system_generated',
  eventId,
  customData = {},
}) {
  if (!config.metaPixelId || !config.metaCapiAccessToken) return { skipped: true, reason: 'missing_config' };

  const userData = {};
  const normalizedPhone = normalizePhoneForMeta(phone);
  if (normalizedPhone) userData.ph = [sha256(normalizedPhone)];

  if (email && String(email).trim()) {
    userData.em = [sha256(String(email).trim())];
  }

  const stableExternalId = externalId || deriveCapiExternalId({ phone, email });
  if (stableExternalId) userData.external_id = [stableExternalId];

  if (Object.keys(userData).length === 0) {
    return { skipped: true, reason: 'missing_user_data' };
  }

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: eventTime || Math.floor(Date.now() / 1000),
        action_source: actionSource,
        event_source_url: eventSourceUrl || config.frontendUrl,
        event_id: eventId,
        user_data: userData,
        custom_data: customData,
      },
    ],
  };

  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${config.metaPixelId}/events`,
      payload,
      {
        params: { access_token: config.metaCapiAccessToken },
        timeout: 10000,
      },
    );
    return { success: true, data };
  } catch (err) {
    logger.warn('Meta CAPI event failed', {
      eventName,
      error: err.response?.data?.error?.message || err.message,
    });
    return { success: false, error: err.response?.data || err.message };
  }
}

module.exports = {
  sendMetaCapiEvent,
  buildExternalIdFromPhone,
  deriveCapiExternalId,
  mapLeadPayloadToCapiEvent,
};
