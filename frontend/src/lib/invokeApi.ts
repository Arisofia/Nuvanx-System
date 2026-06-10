import { supabase, supabaseUrl } from './supabaseClient'

export type InvokeApiOptions = Omit<RequestInit, 'body'> & { body?: unknown }

export async function invokeApi<T = unknown>(functionName: string, init?: InvokeApiOptions): Promise<T> {
  if (!supabaseUrl) {
    throw new Error('Supabase URL no está configurada. Define VITE_SUPABASE_URL en el entorno.')
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) {
    console.error('No se pudo recuperar la sesión de Supabase:', sessionError)
    throw new Error('No se pudo recuperar la sesión autenticada.')
  }

  const accessToken = sessionData?.session?.access_token
  if (!accessToken) {
    throw new Error('No hay sesión activa de Supabase. Inicia sesión antes de consultar la API.')
  }

  const functionPath = functionName.startsWith('/') ? functionName : `/${functionName}`
  const isBrowser = typeof window !== 'undefined'
  const isApiCall = functionPath.startsWith('/api/') || functionPath === '/api'
  const url = isBrowser && isApiCall
    ? functionPath
    : `${supabaseUrl}/functions/v1${functionPath}`

  const headers = new Headers(init?.headers ?? {})
  headers.set('Authorization', `Bearer ${accessToken}`)

  let body: string | undefined
  if (init?.body !== undefined) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    body = JSON.stringify(init.body)
  }

  const response = await fetch(url, {
    method: init?.method || (body ? 'POST' : 'GET'),
    headers,
    body,
  })

  const text = await response.text()
  if (!response.ok) {
    let message = text || response.statusText
    try {
      const json = JSON.parse(text)
      message = json?.error || json?.message || message
    } catch {
      // ignore parse failures
    }
    throw new Error(`invokeApi(${functionName}) falló: ${response.status} ${message}`)
  }

  return text ? (JSON.parse(text) as T) : ({} as T)
}
