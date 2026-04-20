/**
 * Supabase client — Nuvanx Revenue Intelligence Platform
 *
 * Initialised once and exported as a singleton.  All Supabase interactions
 * (auth, database queries) go through this instance.
 *
 * Required environment variables (set in frontend/.env.local):
 *   VITE_SUPABASE_URL              — e.g. https://xyzcompany.supabase.co
 *   VITE_SUPABASE_PUBLISHABLE_KEY  — publishable key from Supabase Connect panel
 *                                    (replaces legacy VITE_SUPABASE_ANON_KEY)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// Prefer the new publishable key; fall back to legacy anon key for existing setups.
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[Supabase] VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY is not set. ' +
      'Supabase features will be disabled. Add these to frontend/.env.local.',
  );
}

export const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

/** Returns true when Supabase is configured and available. */
export function isSupabaseAvailable() {
  return supabase !== null;
}
