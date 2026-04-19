'use strict';

const credentialModel = require('../models/credential');
const integrationModel = require('../models/integration');
const { config } = require('../config/env');

function parseMetaCredential(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  return { access_token: raw };
}

async function resolveMetaCredential(userId) {
  const stored = await credentialModel.getDecryptedKey(userId, 'meta');
  if (stored) {
    const parsed = parseMetaCredential(stored);
    if (parsed?.access_token) {
      return { token: parsed.access_token, adAccountId: parsed.ad_account_id || null, source: 'vault' };
    }
  }

  if (config.allowSharedCredentials && config.metaAccessToken) {
    return {
      token: config.metaAccessToken,
      adAccountId: config.metaAdAccountId || null,
      source: 'shared-env',
    };
  }

  return { token: null, adAccountId: null, source: 'none' };
}

async function resolveMetaAdAccountId(userId) {
  const integrations = await integrationModel.getAll(userId);
  const meta = integrations.find((i) => i.service === 'meta');
  const fromMetadata = meta?.metadata?.adAccountId || null;
  if (fromMetadata) return fromMetadata;

  const resolved = await resolveMetaCredential(userId);
  if (resolved.adAccountId) return resolved.adAccountId;

  if (config.allowSharedCredentials && config.metaAdAccountId) return config.metaAdAccountId;
  return null;
}

module.exports = { parseMetaCredential, resolveMetaCredential, resolveMetaAdAccountId };