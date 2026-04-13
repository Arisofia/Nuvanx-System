'use strict';

// TODO: Replace with PostgreSQL persistence.
//   CREATE TABLE integrations (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id UUID NOT NULL REFERENCES users(id),
//     service VARCHAR(64) NOT NULL,
//     status VARCHAR(32) NOT NULL DEFAULT 'disconnected',
//     last_sync TIMESTAMPTZ,
//     last_error TEXT,
//     metadata JSONB,
//     UNIQUE(user_id, service)
//   );

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

const store = new Map();

function _key(userId, service) {
  return `${userId}:${service}`;
}

function getAll(userId) {
  return SERVICES.map((service) => {
    const record = store.get(_key(userId, service));
    return record
      ? { ...record }
      : {
          service,
          status: 'disconnected',
          lastSync: null,
          lastError: null,
          metadata: {},
        };
  });
}

function upsert(userId, service, update) {
  const k = _key(userId, service);
  const existing = store.get(k) || {
    service,
    userId,
    status: 'disconnected',
    lastSync: null,
    lastError: null,
    metadata: {},
  };
  const updated = { ...existing, ...update };
  store.set(k, updated);
  return updated;
}

module.exports = { getAll, upsert, SERVICES };
