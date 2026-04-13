'use strict';

const { Pool } = require('pg');
const { config } = require('./env');
const logger = require('../utils/logger');

let pool = null;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      logger.warn('DATABASE_URL not set — PostgreSQL pool not initialised');
      return null;
    }
    pool = new Pool({ connectionString: config.databaseUrl });

    pool.on('error', (err) => {
      logger.error('Unexpected PostgreSQL client error', { error: err.message });
    });
  }
  return pool;
}

async function query(text, params) {
  const client = getPool();
  if (!client) throw new Error('Database not configured');
  return client.query(text, params);
}

async function testConnection() {
  try {
    const client = getPool();
    if (!client) return false;
    await client.query('SELECT 1');
    return true;
  } catch (err) {
    logger.error('Database connection test failed', { error: err.message });
    return false;
  }
}

module.exports = { getPool, query, testConnection };
