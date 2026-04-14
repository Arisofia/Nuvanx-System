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

const { createClient } = require('@supabase/supabase-js');
const { config } = require('./env');
const logger = require('../utils/logger');

function buildClient(url, serviceRoleKey, label) {
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
