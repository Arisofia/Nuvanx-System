'use strict';

const { v4: uuidv4 } = require('uuid');
const { pool: getPool, isAvailable } = require('../db');
const logger = require('../utils/logger');

const STAGES = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'];

// ---------------------------------------------------------------------------
// In-memory fallback store
// WARNING: This store is for development and testing only.
// In production, isAvailable() check and environment validation ensure
// that PostgreSQL persistence is used.
// ---------------------------------------------------------------------------
const memStore = new Map();

// ---------------------------------------------------------------------------
// Database helpers — map snake_case DB rows to camelCase app objects
// ---------------------------------------------------------------------------
function _rowToLead(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    source: row.source || 'manual',
    stage: row.stage || 'lead',
    revenue: parseFloat(row.revenue) || 0,
    notes: row.notes || '',
    externalId: row.external_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Public API (all async)
// ---------------------------------------------------------------------------

/**
 * Create a new lead.
 * @returns {object} The created lead.
 */
async function create(userId, data) {
  const stage = STAGES.includes(data.stage) ? data.stage : 'lead';

  if (isAvailable()) {
    try {
      const { rows } = await getPool.query(
        `INSERT INTO leads (user_id, name, email, phone, source, stage, revenue, notes, external_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [
          userId,
          data.name || '',
          data.email || '',
          data.phone || '',
          data.source || 'manual',
          stage,
          parseFloat(data.revenue) || 0,
          data.notes || '',
          data.externalId || null,
        ],
      );
      if (!rows[0]) {
        logger.debug('Lead skipped (duplicate external_id)', { userId, externalId: data.externalId });
        return null;
      }
      logger.debug('Lead created in DB', { userId, leadId: rows[0].id });
      return _rowToLead(rows[0]);
    } catch (err) {
      logger.warn('DB lead create failed, falling back to memory', { error: err.message });
    }
  }

  // In-memory fallback
  const id = uuidv4();
  const now = new Date().toISOString();
  const lead = {
    id,
    userId,
    name: data.name || '',
    email: data.email || '',
    phone: data.phone || '',
    source: data.source || 'manual',
    stage,
    revenue: parseFloat(data.revenue) || 0,
    notes: data.notes || '',
    createdAt: now,
    updatedAt: now,
  };
  memStore.set(id, lead);
  return lead;
}

/**
 * Return all leads for a user, optionally filtered by stage/source.
 * @returns {object[]} Sorted newest-first.
 */
async function findByUser(userId, filters = {}) {
  if (isAvailable()) {
    try {
      const conditions = ['user_id = $1'];
      const params = [userId];
      if (filters.stage) { conditions.push(`stage = $${params.length + 1}`); params.push(filters.stage); }
      if (filters.source) { conditions.push(`source = $${params.length + 1}`); params.push(filters.source); }
      const { rows } = await getPool.query(
        `SELECT * FROM leads WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
        params,
      );
      return rows.map(_rowToLead);
    } catch (err) {
      logger.warn('DB lead findByUser failed, falling back to memory', { error: err.message });
    }
  }

  // In-memory fallback
  const results = [];
  for (const lead of memStore.values()) {
    if (lead.userId !== userId) continue;
    if (filters.stage && lead.stage !== filters.stage) continue;
    if (filters.source && lead.source !== filters.source) continue;
    results.push({ ...lead });
  }
  return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Find a single lead by ID, scoped to the user.
 * @returns {object|null}
 */
async function findById(id, userId) {
  if (isAvailable()) {
    try {
      const { rows } = await getPool.query(
        'SELECT * FROM leads WHERE id = $1 AND user_id = $2',
        [id, userId],
      );
      return rows[0] ? _rowToLead(rows[0]) : null;
    } catch (err) {
      logger.warn('DB lead findById failed, falling back to memory', { error: err.message });
    }
  }

  // In-memory fallback
  const lead = memStore.get(id);
  if (!lead || lead.userId !== userId) return null;
  return { ...lead };
}

/**
 * Update a lead.
 * @returns {object|null} Updated lead, or null if not found.
 */
async function update(id, userId, data) {
  if (isAvailable()) {
    try {
      const stage = data.stage && STAGES.includes(data.stage) ? data.stage : undefined;
      const { rows } = await getPool.query(
        `UPDATE leads
         SET
           name    = COALESCE($3, name),
           email   = COALESCE($4, email),
           phone   = COALESCE($5, phone),
           source  = COALESCE($6, source),
           stage   = COALESCE($7, stage),
           revenue = COALESCE($8, revenue),
           notes   = COALESCE($9, notes)
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [
          id,
          userId,
          data.name ?? null,
          data.email ?? null,
          data.phone ?? null,
          data.source ?? null,
          stage ?? null,
          data.revenue != null ? parseFloat(data.revenue) : null,
          data.notes ?? null,
        ],
      );
      if (!rows[0]) return null;
      logger.debug('Lead updated in DB', { userId, leadId: id });
      return _rowToLead(rows[0]);
    } catch (err) {
      logger.warn('DB lead update failed, falling back to memory', { error: err.message });
    }
  }

  // In-memory fallback
  const lead = memStore.get(id);
  if (!lead || lead.userId !== userId) return null;
  const updated = {
    ...lead,
    ...data,
    id,
    userId,
    stage: data.stage && STAGES.includes(data.stage) ? data.stage : lead.stage,
    updatedAt: new Date().toISOString(),
  };
  memStore.set(id, updated);
  return updated;
}

/**
 * Delete a lead.
 * @returns {boolean}
 */
async function remove(id, userId) {
  if (isAvailable()) {
    try {
      const { rowCount } = await getPool.query(
        'DELETE FROM leads WHERE id = $1 AND user_id = $2',
        [id, userId],
      );
      return rowCount > 0;
    } catch (err) {
      logger.warn('DB lead remove failed, falling back to memory', { error: err.message });
    }
  }

  // In-memory fallback
  const lead = memStore.get(id);
  if (!lead || lead.userId !== userId) return false;
  memStore.delete(id);
  return true;
}

/**
 * Find an existing lead by phone or email and merge new data, or create.
 * Used by webhook handlers to avoid duplicate leads while enriching data.
 * @returns {{ lead: object, merged: boolean }}
 */
async function findOrMerge(userId, data) {
  if (!isAvailable()) {
    const lead = await create(userId, data);
    return { lead, merged: false };
  }

  const phone = (data.phone || '').trim();
  const email = (data.email || '').trim().toLowerCase();

  let existing = null;
  if (phone) {
    const { rows } = await getPool.query(
      'SELECT * FROM leads WHERE user_id = $1 AND phone = $2 LIMIT 1',
      [userId, phone]
    );
    existing = rows[0] || null;
  }
  if (!existing && email) {
    const { rows } = await getPool.query(
      'SELECT * FROM leads WHERE user_id = $1 AND LOWER(email) = $2 LIMIT 1',
      [userId, email]
    );
    existing = rows[0] || null;
  }

  if (existing) {
    // Merge: fill empty fields, never downgrade stage or overwrite notes
    const mergeFields = {};
    if (!existing.name && data.name) mergeFields.name = data.name;
    if (!existing.email && data.email) mergeFields.email = data.email;
    if (!existing.phone && data.phone) mergeFields.phone = data.phone;
    if (data.source && existing.source === 'manual') mergeFields.source = data.source;

    if (Object.keys(mergeFields).length > 0) {
      const updated = await update(existing.id, userId, mergeFields);
      logger.info('Lead merged with existing', { userId, leadId: existing.id, mergeFields });
      return { lead: updated || _rowToLead(existing), merged: true };
    }
    return { lead: _rowToLead(existing), merged: true };
  }

  const lead = await create(userId, data);
  return { lead, merged: false };
}

module.exports = { create, findByUser, findById, update, remove, findOrMerge, STAGES };
