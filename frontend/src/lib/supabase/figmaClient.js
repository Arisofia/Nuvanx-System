/**
 * Supabase client for the Figma V.1 project (zpowfbeftxexzidlxndy).
 *
 * Used for features tied to Figma design-system data stored in this
 * separate Supabase project.
 *
 * Required environment variables (set in frontend/.env):
 *   VITE_SUPABASE_FIGMA_URL      — e.g. https://zpowfbeftxexzidlxndy.supabase.co
 *   VITE_SUPABASE_FIGMA_ANON_KEY — public anon key from Figma project → Settings → API
 */

import { createClient } from '@supabase/supabase-js';

const figmaUrl = import.meta.env.VITE_SUPABASE_FIGMA_URL;
const figmaAnonKey = import.meta.env.VITE_SUPABASE_FIGMA_ANON_KEY;

if (!figmaUrl || !figmaAnonKey) {
  console.warn(
    '[Supabase Figma] VITE_SUPABASE_FIGMA_URL or VITE_SUPABASE_FIGMA_ANON_KEY is not set. ' +
      'Figma project features will be disabled.',
  );
}

export const supabaseFigma =
  figmaUrl && figmaAnonKey
    ? createClient(figmaUrl, figmaAnonKey)
    : null;

/** Returns true when the Figma Supabase project is configured and available. */
export function isFigmaSupabaseAvailable() {
  return supabaseFigma !== null;
}
