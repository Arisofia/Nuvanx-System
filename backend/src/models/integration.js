'use strict';

const { getPool, isAvailable } = require('../db');
const logger = require('../utils/logger');

const SERVICES = [
  'meta',
  'google-calendar',
  'google-gmail',
  'whatsapp',
  'github',
  'openai',
  'gemini',
  'hubspot',
];

// ---------------------------------------------------------------------------
// In-memory fallback store
// WARNING: This store is for development and testing only.
// In production, isAvailable() check and environment validation ensure
// that PostgreSQL persistence is used.
// ---------------------------------------------------------------------------
const memStore = new Map();

function _memKey(userId, service) {
  return `${userId}:${service}`;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------
async function _dbGetAll(userId) {
  const { rows } = await getPool().query(
    'SELECT service, status, last_sync, last_error, metadata FROM integrations WHERE user_id = $1',
    [userId],
  );
  // Fill in any services not yet in the database
  const byService = Object.fromEntries(rows.map((r) => [r.service, r]));
  return SERVICES.map((service) => {
    const row = byService[service];
    return row
      ? {
          service,
          status: row.status,
          lastSync: row.last_sync,
          lastError: row.last_error,
          metadata: row.metadata || {},
        }
      : { service, status: 'disconnected', lastSync: null, lastError: null, metadata: {} };
  });
}

async function _dbUpsert(userId, service, update) {
  const { rows } = await getPool().query(
    `INSERT INTO integrations (user_id, service, status, last_sync, last_error, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, service) DO UPDATE
       SET status     = EXCLUDED.status,
           last_sync  = COALESCE(EXCLUDED.last_sync, integrations.last_sync),
           last_error = EXCLUDED.last_error,
           metadata   = integrations.metadata || EXCLUDED.metadata,
           updated_at = NOW()
     RETURNING service, status, last_sync, last_error, metadata`,
    [
      userId,
      service,
      update.status,
      update.lastSync || null,
      update.lastError || null,
      JSON.stringify(update.metadata || {}),
    ],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Public API (all async)
// ---------------------------------------------------------------------------

/**
 * Return all integration records for a user, filling missing ones with defaults.
 * @returns {object[]}
 */
async function getAll(userId) {
  if (isAvailable()) {
    try {
      return await _dbGetAll(userId);
    } catch (err) {
      logger.warn('DB integration getAll failed, falling back to memory', { error: err.message });
    }
  }

  // In-memory fallback
  return SERVICES.map((service) => {
    const record = memStore.get(_memKey(userId, service));
    return record
      ? { ...record }
      : { service, status: 'disconnected', lastSync: null, lastError: null, metadata: {} };
  });
}

/**
 * Create or update an integration record.
 * @param {string} userId
 * @param {string} service
 * @param {object} update - Fields to set: status, lastSync, lastError, metadata
 * @returns {object} Updated record
 */
async function upsert(userId, service, update) {
  if (isAvailable()) {
    try {
      const row = await _dbUpsert(userId, service, update);
      return {
        service: row.service,
        status: row.status,
        lastSync: row.last_sync,
        lastError: row.last_error,
        metadata: row.metadata || {},
      };
    } catch (err) {
      logger.warn('DB integration upsert failed, falling back to memory', { error: err.message });
    }
  }

  // In-memory fallback
  const k = _memKey(userId, service);
  const existing = memStore.get(k) || {
    service,
    userId,
    status: 'disconnected',
    lastSync: null,
    lastError: null,
    metadata: {},
  };
  const updated = { ...existing, ...update };
  memStore.set(k, updated);
  return updated;
}

module.exports = { getAll, upsert, SERVICES };
