// frontend/src/lib/invokeApi.ts
import { supabase } from './supabaseClient'
import { getMetaContext } from './metaPixel'
import { isBrowser } from './env'

interface InvokeApiOptions {
  body?: Record<string, any>
  headers?: Record<string, string>
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  timeoutMs?: number
  retries?: number
}

export async function invokeApi<T = any>(
  functionName: string,
  options: InvokeApiOptions = {},
): Promise<{ data: T | null; error: Error | null }> {
  const {
    body = {},
    headers = {},
    retries = 1,
    method = 'POST',
    timeoutMs,
  } = options

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
        user_agent: isBrowser() ? navigator.userAgent : undefined,
      },
    }
  }

  const startTime = Date.now()
  let attempt = 0

  while (attempt <= retries) {
    try {
      const controller = timeoutMs ? new AbortController() : undefined
      const timer =
        timeoutMs && controller
          ? setTimeout(() => controller.abort(), timeoutMs)
          : undefined

      const { data, error } = await supabase.functions.invoke(functionName, {
        body: finalBody,
        method,
        headers: {
          ...(import.meta as any).env.VITE_MCP_API_KEY
            ? { 'x-api-key': (import.meta as any).env.VITE_MCP_API_KEY }
            : {},
          ...headers,
        },
        signal: controller?.signal as any,
      })

      if (timer) clearTimeout(timer)

      if (error) {
        console.error(`[invokeApi] Error en ${functionName}:`, {
          status: error.status,
          message: error.message,
          attempt,
        })
        throw Object.assign(new Error(`Edge Function error: ${error.message}`), {
          status: error.status,
        })
      }

      console.log(`[invokeApi] ${functionName} OK (${Date.now() - startTime}ms)`)
      return { data: data as T, error: null }
    } catch (err: any) {
      attempt++
      if (attempt > retries) {
        const richError = Object.assign(
          new Error(
            err?.message ||
              'Error desconocido al llamar la Edge Function',
          ),
          {
            code: err?.status || 'UNKNOWN',
            function: functionName,
            timestamp: new Date().toISOString(),
            details: err,
          },
        )
        console.error('[invokeApi] Error final:', richError)
        return { data: null, error: richError }
      }
      // Pequeño delay antes de reintentar
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  return {
    data: null,
    error: new Error('Máximo de reintentos alcanzado'),
  }
}
