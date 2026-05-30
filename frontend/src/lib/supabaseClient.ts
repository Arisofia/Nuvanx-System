import { createClient } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabaseKey, supabaseUrl } from './env'

export { isSupabaseConfigured, supabaseKey, supabaseUrl }

const fallbackSupabaseUrl = 'https://not-configured.supabase.co'
const fallbackSupabaseKey = 'not-configured-public-key'

export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : fallbackSupabaseUrl,
  isSupabaseConfigured ? supabaseKey : fallbackSupabaseKey,
)

// Backward-compatible re-export for legacy imports:
// import { invokeApi } from '../lib/supabaseClient'
export { invokeApi } from './invokeApi'
