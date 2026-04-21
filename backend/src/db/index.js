'use strict';

/**
 * PostgreSQL connection pool.
 *
 * Connection is established only when DATABASE_URL (or SUPABASE_DATABASE_KEY)
 * is present in the environment.  All model files must call isAvailable() before
 * using the pool and fall back to in-memory storage when it returns false — this
 * keeps the test suite working without a real database.
 *
 * Usage:
 *   const { pool, isAvailable } = require('../db');
 *   if (isAvailable()) { const { rows } = await pool.query(...); }
 */

const { Pool } = require('pg');
const { config } = require('../config/env');
const logger = require('../utils/logger');

let pool = null;
const isProduction = config.nodeEnv === 'production';

if (config.databaseUrl) {
  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
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
  pool.query('SELECT 1').catch((err) => {
    if (isProduction) {
      logger.error('pg pool: initial connectivity check failed in production — exiting', {
        error: err.message,
      });
      process.exit(1);
    } else {
      logger.warn('pg pool: initial connectivity check failed — running in in-memory mode', {
        error: err.message,
      });
      pool = null;
    }
  });
} else {
  if (isProduction) {
    logger.error('DATABASE_URL not set in production — exiting');
    process.exit(1);
  }
  logger.warn(
    'DATABASE_URL not set — using in-memory storage (data will be lost on restart). ' +
    'Set DATABASE_URL in your .env file to your Supabase PostgreSQL connection string: ' +
    'Supabase Dashboard → Project Settings → Database → Connection string → URI',
  );
}

function isAvailable() {
  return pool !== null;
}

// Use a getter so that callers always see the current value of `pool`
// (it can be set to null asynchronously if the initial connectivity check fails).
module.exports = {
  get pool() { return pool; },
  isAvailable,
  isProduction,
};
