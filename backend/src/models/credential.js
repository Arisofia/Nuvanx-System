'use strict';

const { v4: uuidv4 } = require('uuid');
const { encrypt, decrypt } = require('../services/encryption');
const logger = require('../utils/logger');

// TODO: Replace this in-memory store with a PostgreSQL table:
//   CREATE TABLE credentials (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id UUID NOT NULL REFERENCES users(id),
//     service VARCHAR(64) NOT NULL,
//     encrypted_key TEXT NOT NULL,
//     created_at TIMESTAMPTZ DEFAULT NOW(),
//     last_used TIMESTAMPTZ,
//     UNIQUE(user_id, service)
//   );
const store = new Map();

function _storeKey(userId, service) {
  return `${userId}:${service}`;
}

/**
 * Save (or overwrite) a credential for a user+service pair.
 * The raw apiKey is encrypted before storage.
 */
function save(userId, service, rawApiKey) {
  const key = _storeKey(userId, service);
  const existing = store.get(key);
  const record = {
    id: existing ? existing.id : uuidv4(),
    userId,
    service,
    encryptedKey: encrypt(rawApiKey),
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    lastUsed: null,
  };
  store.set(key, record);
  logger.debug('Credential saved', { userId, service });
  return { id: record.id, service: record.service, createdAt: record.createdAt };
}

/**
 * Retrieve and decrypt the API key for a user+service pair.
 * MUST only be called server-side; never pass the result to the client.
 */
function getDecryptedKey(userId, service) {
  const record = store.get(_storeKey(userId, service));
  if (!record) return null;

  record.lastUsed = new Date().toISOString();
  return decrypt(record.encryptedKey);
}

/**
 * Return metadata (no keys) for all credentials belonging to a user.
 */
function listByUser(userId) {
  const results = [];
  for (const record of store.values()) {
    if (record.userId === userId) {
      results.push({
        id: record.id,
        service: record.service,
        createdAt: record.createdAt,
        lastUsed: record.lastUsed,
      });
    }
  }
  return results;
}

/**
 * Delete a credential for a user+service pair.
 */
function remove(userId, service) {
  const key = _storeKey(userId, service);
  const existed = store.has(key);
  store.delete(key);
  return existed;
}

module.exports = { save, getDecryptedKey, listByUser, remove };
