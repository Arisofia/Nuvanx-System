// frontend/src/lib/invokeApi.ts
import { supabase, supabaseUrl } from './supabaseClient'

export type InvokeApiOptions = Omit<RequestInit, 'body'> & { body?: unknown }

export async function invokeApi<T = unknown>(functionName: string, init?: InvokeApiOptions): Promise<T> {
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured. Set VITE_SUPABASE_URL in your environment.')
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) {
    console.error('Failed to retrieve Supabase session:', sessionError)
    throw new Error('Unable to retrieve authenticated session.')
  }

  const accessToken = sessionData?.session?.access_token
  if (!accessToken) {
    throw new Error('No authenticated Supabase session available. Sign in before calling invokeApi.')
  }

  const functionPath = functionName.startsWith('/') ? functionName : `/${functionName}`
  const url = `${supabaseUrl}/functions/v1${functionPath}`

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
    throw new Error(`invokeApi(${functionName}) failed: ${response.status} ${message}`)
  }

  return text ? (JSON.parse(text) as T) : ({} as T)
}
