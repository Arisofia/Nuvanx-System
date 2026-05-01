import { createClient, SupabaseClient } from '@supabase/supabase-js'

const placeholderPattern = /your_supabase_project_ref|your-public-anon-key|your-anon-key/i

function sanitizeEnv(value) {
  return value && !placeholderPattern.test(value) ? value : ''
}

export const supabaseUrl = sanitizeEnv(import.meta.env.VITE_SUPABASE_URL || '')
export const supabaseKey =
  sanitizeEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '') ||
  sanitizeEnv(import.meta.env.VITE_SUPABASE_ANON_KEY || '')

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

export const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : (createMockClient() as unknown as SupabaseClient)

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '⚠️ Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your environment.',
  )
}

export async function invokeApi(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (supabase.functions && typeof supabase.functions.invoke === 'function') {
    const response = await supabase.functions.invoke(`api${normalizedPath}`)
    if ((response as any).error) {
      throw (response as any).error
    }
    return (response as any).data
  }

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase not configured')
  }

  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/api${normalizedPath}`
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token || supabaseKey

  const res = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.message || 'Function invocation failed')
  }
  return data
}
