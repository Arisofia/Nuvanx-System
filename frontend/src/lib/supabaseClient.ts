import { createClient } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabaseKey, supabaseUrl } from './env'

export { isSupabaseConfigured, supabaseKey, supabaseUrl }

function createSupabaseClient() {
  if (!isSupabaseConfigured) {
    return createClient('https://localhost.supabase.co', 'not-configured')
  }

  return createClient(supabaseUrl, supabaseKey)
}

export const supabase = createSupabaseClient()

// Backward-compatible re-export for legacy imports:
// import { invokeApi } from '../lib/supabaseClient'
export { invokeApi } from './invokeApi'
