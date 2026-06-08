const placeholderPattern = /your_supabase_project_ref|your-project\.supabase\.co|your-public-anon-key|your-anon-key|your-publishable-key|voerikxpncvrrhnxzbxm/i

function sanitizeEnv(value: string | undefined) {
  const normalized = value?.trim() ?? ''
  return normalized && !placeholderPattern.test(normalized) ? normalized : ''
}

/**
 * Dev-only utility to check if we're in a browser runtime.
 */
export const isBrowser = (): boolean =>
  globalThis.window !== undefined

/**
 * Supabase URL and publishable key.
 *
 * These values must come from Vercel environment variables. There is no
 * production fallback here by design: binding a production build to a hardcoded
 * project or stale key makes audits unreliable and can hide misconfiguration.
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

if (import.meta.env.DEV && import.meta.env.VITE_SUPABASE_URL && !sanitizeEnv(import.meta.env.VITE_SUPABASE_URL)) {
  console.warn('[env] Ignoring stale or placeholder Supabase URL.')
}
