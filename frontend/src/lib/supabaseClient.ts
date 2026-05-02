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

  // Use relative /api/... so the request goes through the Vercel server-side
  // proxy (vercel.json rewrite: /api/* → Edge Function). This avoids CORS
  // entirely — the browser sees it as a same-origin request.
  // In local dev, the Vite server proxy in vite.config.js forwards /api/* to
  // VITE_SUPABASE_URL/functions/v1.
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token || supabaseKey

  const res = await fetch(`/api${normalizedPath}`, {
    method,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data: any
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    data = await res.json()
  } else {
    const text = await res.text()
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`)
    data = {}
  }
  if (!res.ok) {
    throw new Error(data?.message || 'Function invocation failed')
  }
  return data
}
