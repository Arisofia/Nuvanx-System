function sanitizeEnv(value: string | undefined) {
  return value?.trim() ?? ''
}

function sanitizeSupabaseUrl(value: string | undefined) {
  const normalized = sanitizeEnv(value)
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(normalized) ? normalized : ''
}

function sanitizeSupabaseKey(value: string | undefined) {
  const normalized = sanitizeEnv(value)
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(normalized) ? normalized : ''
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
export const supabaseUrl = sanitizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
export const supabaseKey =
  sanitizeSupabaseKey(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
  sanitizeSupabaseKey(import.meta.env.VITE_SUPABASE_ANON_KEY)

export const metaAppId = sanitizeEnv(import.meta.env.VITE_META_APP_ID)
export const metaPixelId = sanitizeEnv(import.meta.env.VITE_META_PIXEL_ID)
export const metaAccountIds = sanitizeEnv(import.meta.env.VITE_META_AD_ACCOUNT_IDS)
export const metaPageId = sanitizeEnv(import.meta.env.VITE_META_PAGE_ID)
export const metaInstagramChamberiId = sanitizeEnv(import.meta.env.VITE_META_INSTAGRAM_CHAMBERI_ID)
export const metaInstagramGoyaId = sanitizeEnv(import.meta.env.VITE_META_INSTAGRAM_GOYA_ID)
export const metaBusinessPortfolioNuvanxId = sanitizeEnv(import.meta.env.VITE_META_BUSINESS_PORTFOLIO_NUVANX_ID)
export const metaBusinessPortfolioYolandaId = sanitizeEnv(import.meta.env.VITE_META_BUSINESS_PORTFOLIO_YOLANDA_ID)
export const googleAdsAccountIds = sanitizeEnv(import.meta.env.VITE_GOOGLE_ADS_ACCOUNT_IDS)

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[env] Supabase is not fully configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY).',
  )
}

if (import.meta.env.DEV && import.meta.env.VITE_SUPABASE_URL && !sanitizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)) {
  console.warn('[env] Ignoring invalid Supabase URL format.')
}
