'use strict';

const { v4: uuidv4 } = require('uuid');

// TODO: Replace with PostgreSQL persistence.
//   CREATE TABLE leads (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id UUID NOT NULL REFERENCES users(id),
//     name VARCHAR(255),
//     email VARCHAR(255),
//     phone VARCHAR(64),
//     source VARCHAR(64),
//     stage VARCHAR(64) DEFAULT 'lead',
//     revenue NUMERIC(12,2),
//     created_at TIMESTAMPTZ DEFAULT NOW(),
//     updated_at TIMESTAMPTZ DEFAULT NOW()
//   );

const STAGES = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'];

const store = new Map();

function create(userId, data) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const lead = {
    id,
    userId,
    name: data.name || '',
    email: data.email || '',
    phone: data.phone || '',
    source: data.source || 'manual',
    stage: STAGES.includes(data.stage) ? data.stage : 'lead',
    revenue: parseFloat(data.revenue) || 0,
    notes: data.notes || '',
    createdAt: now,
    updatedAt: now,
  };
  store.set(id, lead);
  return lead;
}

function findByUser(userId, filters = {}) {
  const results = [];
  for (const lead of store.values()) {
    if (lead.userId !== userId) continue;
    if (filters.stage && lead.stage !== filters.stage) continue;
    if (filters.source && lead.source !== filters.source) continue;
    results.push({ ...lead });
  }
  return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function findById(id, userId) {
  const lead = store.get(id);
  if (!lead || lead.userId !== userId) return null;
  return { ...lead };
}

function update(id, userId, data) {
  const lead = store.get(id);
  if (!lead || lead.userId !== userId) return null;
  const updated = {
    ...lead,
    ...data,
    id,
    userId,
    stage: data.stage && STAGES.includes(data.stage) ? data.stage : lead.stage,
    updatedAt: new Date().toISOString(),
  };
  store.set(id, updated);
  return updated;
}

function remove(id, userId) {
  const lead = store.get(id);
  if (!lead || lead.userId !== userId) return false;
  store.delete(id);
  return true;
}

module.exports = { create, findByUser, findById, update, remove, STAGES };
