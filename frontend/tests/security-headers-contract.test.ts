import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const vercel = JSON.parse(
  readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'),
) as {
  headers?: Array<{
    source?: string
    headers?: Array<{ key?: string; value?: string }>
  }>
}

function headerMap() {
  const route = vercel.headers?.find((entry) => entry.source === '/(.*)')
  return new Map((route?.headers || []).map((entry) => [String(entry.key), String(entry.value)]))
}

function parseCsp(value: string) {
  return new Map(
    value
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [directive, ...sources] = part.split(/\s+/)
        return [directive, sources] as const
      }),
  )
}

describe('Control Centre Vercel security headers', () => {
  it('sets the required browser security baseline on every route', () => {
    const headers = headerMap()
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(headers.get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    )
  })

  it('keeps CSP fail-closed while allowing only the actual browser runtime dependencies', () => {
    const directives = parseCsp(headerMap().get('Content-Security-Policy') || '')

    expect(directives.get('default-src')).toEqual(["'self'"])
    expect(directives.get('base-uri')).toEqual(["'self'"])
    expect(directives.get('form-action')).toEqual(["'self'"])
    expect(directives.get('frame-ancestors')).toEqual(["'none'"])
    expect(directives.get('object-src')).toEqual(["'none'"])

    expect(directives.get('script-src')).toEqual([
      "'self'",
      'https://connect.facebook.net',
    ])
    expect(directives.get('style-src')).toEqual([
      "'self'",
      "'unsafe-inline'",
      'https://fonts.googleapis.com',
    ])
    expect(directives.get('font-src')).toEqual([
      "'self'",
      'data:',
      'https://fonts.gstatic.com',
    ])
    expect(directives.get('connect-src')).toEqual([
      "'self'",
      'https://*.supabase.co',
      'wss://*.supabase.co',
      'https://www.facebook.com',
      'https://*.ingest.sentry.io',
      'https://*.ingest.us.sentry.io',
    ])
    expect(directives.get('img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https://www.facebook.com',
    ])
    expect(directives.get('worker-src')).toEqual(["'self'", 'blob:'])
    expect(directives.get('manifest-src')).toEqual(["'self'"])
    expect(directives.get('script-src')).not.toContain("'unsafe-inline'")
  })
})
