'use strict';

const { v4: uuidv4 } = require('uuid');
const { encrypt, decrypt } = require('../services/encryption');
const { pool: getPool, isAvailable } = require('../db');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// In-memory fallback store
// WARNING: This store is for development and testing only.
// In production, isAvailable() check and environment validation ensure
// that PostgreSQL persistence is used.
// Data is lost on process exit.
// ---------------------------------------------------------------------------
const memStore = new Map();

function _memKey(userId, service) {
  return `${userId}:${service}`;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------
async function _dbSave(userId, service, encryptedKey) {
  const { rows } = await getPool.query(
    `INSERT INTO credentials (user_id, service, encrypted_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, service) DO UPDATE
       SET encrypted_key = EXCLUDED.encrypted_key
     RETURNING id, service, created_at`,
    [userId, service, encryptedKey],
  );
  return rows[0];
}

async function _dbGetEncrypted(userId, service) {
  await getPool.query(
    'UPDATE credentials SET last_used = NOW() WHERE user_id = $1 AND service = $2',
    [userId, service],
  );
  const { rows } = await getPool.query(
    'SELECT encrypted_key FROM credentials WHERE user_id = $1 AND service = $2',
    [userId, service],
  );
  return rows[0]?.encrypted_key || null;
}

async function _dbList(userId) {
  const { rows } = await getPool.query(
    'SELECT id, service, created_at, last_used FROM credentials WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  return rows;
}

async function _dbRemove(userId, service) {
  const { rowCount } = await getPool.query(
    'DELETE FROM credentials WHERE user_id = $1 AND service = $2',
    [userId, service],
  );
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
// Public API (all async)
// ---------------------------------------------------------------------------

/**
 * Save (or overwrite) a credential for a user+service pair.
 * The raw apiKey is encrypted before storage.
 * @returns {object} Metadata only (id, service, createdAt) — never the raw key.
 */
async function save(userId, service, rawApiKey) {
  const encryptedKey = encrypt(rawApiKey);

  if (isAvailable()) {
    try {
      const row = await _dbSave(userId, service, encryptedKey);
      logger.debug('Credential saved to DB', { userId, service });
      return { id: row.id, service: row.service, createdAt: row.created_at };
    } catch (err) {
      logger.warn('DB credential save failed, falling back to memory', { error: err.message });
    }
  }

  // In-memory fallback
  const k = _memKey(userId, service);
  const existing = memStore.get(k);
  const record = {
    id: existing ? existing.id : uuidv4(),
    userId,
    service,
    encryptedKey,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    lastUsed: null,
  };
  memStore.set(k, record);
  logger.debug('Credential saved to memory', { userId, service });
  return { id: record.id, service: record.service, createdAt: record.createdAt };
}

/**
 * Retrieve and decrypt the API key for a user+service pair.
 * MUST only be called server-side; never pass the result to the client.
 * @returns {string|null}
 */
async function getDecryptedKey(userId, service) {
  if (isAvailable()) {
    try {
      const encryptedKey = await _dbGetEncrypted(userId, service);
      if (!encryptedKey) return null;
      return decrypt(encryptedKey);
    } catch (err) {
      logger.warn('DB credential get failed, falling back to memory', { error: err.message });
    }
  }

  // In-memory fallback
  const record = memStore.get(_memKey(userId, service));
  if (!record) return null;
  record.lastUsed = new Date().toISOString();
  return decrypt(record.encryptedKey);
}

/**
 * Return metadata (no keys) for all credentials belonging to a user.
 * @returns {object[]}
 */
async function listByUser(userId) {
  if (isAvailable()) {
    try {
      return await _dbList(userId);
    } catch (err) {
      logger.warn('DB credential list failed, falling back to memory', { error: err.message });
    }
  }

  // In-memory fallback
  const results = [];
  for (const record of memStore.values()) {
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
 * @returns {boolean} true if the credential existed and was removed.
 */
async function remove(userId, service) {
  if (isAvailable()) {
    try {
      return await _dbRemove(userId, service);
    } catch (err) {
      logger.warn('DB credential remove failed, falling back to memory', { error: err.message });
    }
  }

  // In-memory fallback
  const k = _memKey(userId, service);
  const existed = memStore.has(k);
  memStore.delete(k);
  return existed;
}

module.exports = { save, getDecryptedKey, listByUser, remove };
