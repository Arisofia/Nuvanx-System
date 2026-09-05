'use strict';

const SUPABASE_PROJECT_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.supabase\.co$/;

function normalizeSupabaseBase(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('SUPABASE_URL must be a valid Supabase HTTPS origin');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || !SUPABASE_PROJECT_HOST.test(hostname)
  ) {
    throw new Error('SUPABASE_URL must be a valid Supabase HTTPS origin');
  }

  return `https://${hostname}`;
}

module.exports = {
  normalizeSupabaseBase,
};
