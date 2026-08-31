import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const frontendRoot = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

const wrangler = JSON.parse(readFileSync(`${frontendRoot}/wrangler.jsonc`, 'utf8')) as {
  name?: string
  compatibility_date?: string
  workers_dev?: boolean
  assets?: { directory?: string; not_found_handling?: string }
}

const headers = readFileSync(`${frontendRoot}/public/_headers`, 'utf8')
const workflow = readFileSync(`${repoRoot}/.github/workflows/deploy-cloudflare.yml`, 'utf8')

describe('Cloudflare frontend deployment contract', () => {
  it('deploys the Vite build as a Workers Static Assets SPA', () => {
    expect(wrangler.name).toBe('nuvanx-frontend')
    expect(wrangler.compatibility_date).toBe('2026-08-31')
    expect(wrangler.workers_dev).toBe(true)
    expect(wrangler.assets?.directory).toBe('./dist')
    expect(wrangler.assets?.not_found_handling).toBe('single-page-application')
  })

  it('preserves the existing browser security baseline', () => {
    expect(headers).toContain('X-Frame-Options: DENY')
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin')
    expect(headers).toContain('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    expect(headers).toContain("Content-Security-Policy: default-src 'self'")
    expect(headers).toContain("frame-ancestors 'none'")
    expect(headers).toContain("object-src 'none'")
    expect(headers).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('keeps acceptance deployment manual until the cutover is approved', () => {
    expect(workflow).toMatch(/workflow_dispatch:/)
    expect(workflow).not.toMatch(/\n\s+push:/)
    expect(workflow).toContain('CLOUDFLARE_API_TOKEN')
    expect(workflow).toContain('CLOUDFLARE_ACCOUNT_ID')
    expect(workflow).toContain('wrangler@4.127.1')
  })

  it('never exposes the backend MCP secret as a VITE variable in Cloudflare builds', () => {
    expect(workflow).not.toContain('VITE_MCP_API_KEY')
    expect(workflow).not.toMatch(/VITE_[A-Z0-9_]+:\s*\$\{\{\s*secrets\.MCP_API_KEY/)
  })
})
