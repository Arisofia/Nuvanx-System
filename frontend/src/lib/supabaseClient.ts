import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY || ''

function createMockClient() {
  return {
    from: () => ({
      select: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
    }),
    functions: {
      invoke: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
    },
    auth: {
      signInWithPassword: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
      signOut: () => Promise.resolve({ error: null }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    },
  }
}

const supabase: SupabaseClient | ReturnType<typeof createMockClient> =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : createMockClient()

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '⚠️ Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your environment.',
  )
}

export { supabase }
