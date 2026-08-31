import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const master = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/master.yml', import.meta.url)),
  'utf8',
)
const cloudflare = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/deploy-cloudflare.yml', import.meta.url)),
  'utf8',
)

const frontendBuildSections = [master, cloudflare]

describe('browser build secret boundary', () => {
  it('never maps the backend MCP secret into a VITE browser variable', () => {
    for (const workflow of frontendBuildSections) {
      expect(workflow).not.toContain('VITE_MCP_API_KEY')
      expect(workflow).not.toMatch(/VITE_[A-Z0-9_]+:\s*\$\{\{\s*secrets\.MCP_API_KEY\s*\}\}/)
    }
  })

  it('keeps Cloudflare build inputs limited to browser-public integration variables', () => {
    expect(cloudflare).toContain('VITE_SUPABASE_URL')
    expect(cloudflare).toContain('VITE_SUPABASE_PUBLISHABLE_KEY')
    expect(cloudflare).toContain('VITE_SUPABASE_ANON_KEY')
    expect(cloudflare).toContain('VITE_SENTRY_DSN')
    expect(cloudflare).not.toMatch(/VITE_[A-Z0-9_]+:\s*\$\{\{\s*secrets\.(?:SUPABASE_SERVICE_ROLE_KEY|MCP_API_KEY|ENCRYPTION_KEY|META_APP_SECRET|GOOGLE_ADS_DEVELOPER_TOKEN)/)
  })

  it('allows MCP_API_KEY only in backend/test contexts without a VITE prefix', () => {
    expect(master).toContain('MCP_API_KEY: ${{ secrets.MCP_API_KEY || \'\' }}')
    expect(master).not.toContain('VITE_MCP_API_KEY:')
  })
})
