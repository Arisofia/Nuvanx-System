'use strict';

/**
 * PostgreSQL connection pool.
 *
 * In production (NODE_ENV=production) a DATABASE_URL is mandatory and any
 * connectivity failure aborts the process immediately — there is no silent
 * fallback to in-memory storage in production.
 *
 * In non-production environments (development, test) the pool is optional:
 * when DATABASE_URL is absent or the connection check fails the module logs a
 * warning and all model files fall back to in-memory storage, which is safe
 * for local dev and the Jest test suite.
 *
 * Usage:
 *   const { pool, isAvailable } = require('../db');
 *   if (isAvailable()) { const { rows } = await pool.query(...); }
 */

const { Pool } = require('pg');
const { config } = require('../config/env');
const logger = require('../utils/logger');

const isProduction = config.nodeEnv === 'production';

let pool = null;

if (config.databaseUrl) {
  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('connect', () => {
    logger.info('pg pool: new client connected');
  });

  pool.on('error', (err) => {
    logger.error('pg pool: idle client error', { error: err.message });
  });

  // Verify connectivity at startup.
  // In production: any failure is fatal — the process must not start without DB.
  // In development/test: log a warning and fall back to in-memory storage.
  pool.query('SELECT 1').catch((err) => {
    if (isProduction) {
      logger.error('pg pool: connectivity check failed in production — aborting startup', {
        error: err.message,
      });
      process.exit(1);
    }
    logger.warn('pg pool: initial connectivity check failed — running in in-memory mode', {
      error: err.message,
    });
    pool = null;
  });
} else if (isProduction) {
  logger.error('DATABASE_URL is required in production — aborting startup');
  process.exit(1);
} else {
  logger.warn('DATABASE_URL not set — using in-memory storage (data will be lost on restart)');
}

function isAvailable() {
  return pool !== null;
}

module.exports = { pool, isAvailable };
