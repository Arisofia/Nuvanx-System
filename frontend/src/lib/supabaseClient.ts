import { createClient } from '@supabase/supabase-js'

const placeholderPattern = /your_supabase_project_ref|your-public-anon-key|your-anon-key/i

function sanitizeEnv(value: string | undefined) {
  return value && !placeholderPattern.test(value) ? value : ''
}

export const supabaseUrl = sanitizeEnv(import.meta.env.VITE_SUPABASE_URL)
export const supabaseKey =
  sanitizeEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
  sanitizeEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. Mock clients are disabled.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey)

export async function invokeApi(path: string, options?: { method?: string; body?: Record<string, unknown> }) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const method = options?.method?.toUpperCase() ?? 'GET'
  const body = options?.body

  if (supabase.functions && typeof supabase.functions.invoke === 'function') {
    const response = await supabase.functions.invoke(`api${normalizedPath}`, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    })
    if ((response as any).error) {
      throw (response as any).error
    }
    return (response as any).data
  }

  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/api${normalizedPath}`
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token || supabaseKey

  const res = await fetch(url, {
    method,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.message || 'Function invocation failed')
  }
  return data
}
