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

describe('Control Centre Vercel security headers', () => {
  it('sets the required browser security baseline on every route', () => {
    const headers = headerMap()
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(headers.get('Permissions-Policy')).toContain('camera=()')
    expect(headers.get('Permissions-Policy')).toContain('microphone=()')
    expect(headers.get('Permissions-Policy')).toContain('geolocation=()')
  })

  it('keeps CSP fail-closed while allowing the actual Supabase and font runtime dependencies', () => {
    const csp = headerMap().get('Content-Security-Policy') || ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(csp).toContain('https://*.supabase.co')
    expect(csp).toContain('wss://*.supabase.co')
    expect(csp).toContain('https://fonts.googleapis.com')
    expect(csp).toContain('https://fonts.gstatic.com')
  })
})
