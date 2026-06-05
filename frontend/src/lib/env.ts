const placeholderPattern = /your_supabase_project_ref|your-public-anon-key|your-anon-key/i

function sanitizeEnv(value: string | undefined) {
  return value && !placeholderPattern.test(value) ? value : ''
}

/**
 * Dev-only utility to check if we're in a browser runtime.
 */
export const isBrowser = (): boolean =>
  globalThis.window !== undefined

/**
 * Supabase URL and key taken from Vite env vars.
 */
export const supabaseUrl = sanitizeEnv(import.meta.env.VITE_SUPABASE_URL)
export const supabaseKey =
  sanitizeEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
  sanitizeEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)

export const metaPixelId = sanitizeEnv(import.meta.env.VITE_META_PIXEL_ID)
export const metaAccountIds = sanitizeEnv(import.meta.env.VITE_META_AD_ACCOUNT_IDS)
export const googleAdsAccountIds = sanitizeEnv(import.meta.env.VITE_GOOGLE_ADS_ACCOUNT_IDS)

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[env] Supabase is not fully configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY).',
  )
}
