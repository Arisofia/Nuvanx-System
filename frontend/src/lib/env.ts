const PROD_SUPABASE_URL = 'https://ssvvuuysgxyqvmovrlvk.supabase.co'
const PROD_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4sW8xPTuBEIx4ng9aJsI3A_z0wyhXOp'

const placeholderPattern = /your_supabase_project_ref|your-project\.supabase\.co|your-public-anon-key|your-anon-key|your-publishable-key|voerikxpncvrrhnxzbxm/i

function sanitizeEnv(value: string | undefined) {
  return value && !placeholderPattern.test(value) ? value : ''
}

/**
 * Dev-only utility to check if we're in a browser runtime.
 */
export const isBrowser = (): boolean =>
  globalThis.window !== undefined

/**
 * Supabase URL and key.
 *
 * Vercel should provide VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
 * The production fallback prevents the frontend from accidentally binding to the
 * old Figma/placeholder project when Vercel env vars are missing or stale.
 */
export const supabaseUrl = sanitizeEnv(import.meta.env.VITE_SUPABASE_URL) || PROD_SUPABASE_URL
export const supabaseKey =
  sanitizeEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
  sanitizeEnv(import.meta.env.VITE_SUPABASE_ANON_KEY) ||
  PROD_SUPABASE_PUBLISHABLE_KEY

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
  console.warn('[env] Ignoring stale or placeholder Supabase URL and using nuvanx-prod fallback.')
}
