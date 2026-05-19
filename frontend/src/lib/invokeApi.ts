// frontend/src/lib/invokeApi.ts
import { supabase } from './supabaseClient'
import { getMetaContext } from './metaPixel'

interface InvokeApiOptions {
  body?: Record<string, any>
  headers?: Record<string, string>
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  timeoutMs?: number
  retries?: number
}

export async function invokeApi<T = any>(
  functionName: string,
  options: InvokeApiOptions = {}
): Promise<{ data: T | null; error: Error | null }> {
  const { body = {}, headers = {}, retries = 1, method = 'POST' } = options

  /**
   * Enriquecer el body con contexto de Meta si es una mutación.
   * Esto permite que CAPI tenga mejores parámetros de matching (EMQ).
   * El test_event_code se puede pasar en el body desde la UI de pruebas.
   */
  let finalBody = body
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    const meta = getMetaContext()
    finalBody = {
      ...body,
      _meta: {
        ...(body._meta || {}),
        fbc: meta.fbc,
        fbp: meta.fbp,
        user_agent: typeof window !== 'undefined' ? navigator.userAgent : undefined,
      }
    }
  }

  const startTime = Date.now()
  let attempt = 0

  while (attempt <= retries) {
    try {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: finalBody,
        method,
        headers: {
          'x-api-key': (import.meta as any).env.VITE_MCP_API_KEY || '',
          ...headers,
        },
      })

      if (error) {
        console.error(`[invokeApi] Error en ${functionName}:`, {
          status: error.status,
          message: error.message,
          attempt,
        })
        throw new Error(`Edge Function error: ${error.message}`)
      }

      console.log(`[invokeApi] ${functionName} OK (${Date.now() - startTime}ms)`)
      return { data: data as T, error: null }
    } catch (err: any) {
      attempt++
      if (attempt > retries) {
        const richError = {
          code: err.status || 'UNKNOWN',
          message: err.message || 'Error desconocido al llamar la Edge Function',
          function: functionName,
          timestamp: new Date().toISOString(),
          details: err,
        }
        console.error('[invokeApi] Error final:', richError)
        return { data: null, error: richError as any }
      }
      // Pequeño delay antes de reintentar
      await new Promise(r => setTimeout(r, 300))
    }
  }

  return { data: null, error: new Error('Máximo de reintentos alcanzado') }
}
