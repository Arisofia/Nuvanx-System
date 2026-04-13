/**
 * Supabase client — Nuvanx Revenue Intelligence Platform
 *
 * Initialised once and exported as a singleton.  All Supabase interactions
 * (auth, database queries) go through this instance.
 *
 * Required environment variables (set in frontend/.env.local):
 *   VITE_SUPABASE_URL   — e.g. https://xyzcompany.supabase.co
 *   VITE_SUPABASE_ANON_KEY — public anon key from Project Settings → API
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. ' +
      'Supabase features will be disabled. See SUPABASE_SETUP.md for setup instructions.',
  );
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

/** Returns true when Supabase is configured and available. */
export function isSupabaseAvailable() {
  return supabase !== null;
}
