'use strict';

/**
 * Supabase admin clients for the backend.
 *
 * Uses the service-role key so these clients bypass Row Level Security and
 * are safe for server-side operations only — never expose to the browser.
 *
 * Two clients are exported:
 *   supabaseAdmin        — main project (ssvvuuysgxyqvmovrlvk)
 *   supabaseFigmaAdmin   — Figma V.1 project (ssvvuuysgxyqvmovrlvk)
 *
 * Both are null when the required env vars are not set so the rest of the
 * app can degrade gracefully.
 */

const { config } = require('./env');
const logger = require('../utils/logger');

let createClient = null;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (err) {
  logger.warn('[Supabase] @supabase/supabase-js not installed — clients disabled', {
    error: err.message,
  });
}

function buildClient(url, serviceRoleKey, label) {
  if (!createClient) {
    logger.warn(`[Supabase] ${label} admin client not initialised — client library unavailable`);
    return null;
  }
  if (!url || !serviceRoleKey) {
    logger.warn(`[Supabase] ${label} admin client not initialised — missing env vars`);
    return null;
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

const supabaseAdmin = buildClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  'main',
);

const supabaseFigmaAdmin = buildClient(
  config.supabaseFigmaUrl,
  config.supabaseFigmaServiceRoleKey,
  'figma',
);

module.exports = { supabaseAdmin, supabaseFigmaAdmin };
