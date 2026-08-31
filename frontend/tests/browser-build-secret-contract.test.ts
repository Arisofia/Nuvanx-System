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

const frontendBuildSections = { master, cloudflare }

// Backend-only secrets that must never reach a browser (VITE_*) build input.
const BACKEND_SECRETS = [
  'MCP_API_KEY',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'DATABASE_URL',
  'META_APP_SECRET',
  'META_REPORTING_TOKEN_60D',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_SERVICE_ACCOUNT',
  'CLOUDFLARE_API_TOKEN',
  'SHEETS_WEBHOOK_SECRET_DOCTORALIA',
]

describe('browser build secret boundary', () => {
  it('never maps any backend secret into a VITE browser variable', () => {
    for (const [name, workflow] of Object.entries(frontendBuildSections)) {
      expect(workflow, name).not.toContain('VITE_MCP_API_KEY')
      for (const secret of BACKEND_SECRETS) {
        // Match VITE_*: ${{ ... secrets.SECRET ... }} regardless of fallback (`|| ''`) or spacing.
        const pattern = new RegExp(
          `VITE_[A-Z0-9_]+:\\s*\\$\\{\\{[^}]*secrets\\.${secret}[^}]*\\}\\}`,
        )
        expect(workflow, `${name} exposes ${secret}`).not.toMatch(pattern)
      }
    }
  })

  it('keeps Cloudflare build inputs limited to browser-public integration variables', () => {
    expect(cloudflare).toContain('VITE_SUPABASE_URL')
    expect(cloudflare).toContain('VITE_SUPABASE_PUBLISHABLE_KEY')
    expect(cloudflare).toContain('VITE_SUPABASE_ANON_KEY')
    expect(cloudflare).toContain('VITE_SENTRY_DSN')
  })

  it('allows MCP_API_KEY only in backend/test contexts without a VITE prefix', () => {
    expect(master).toContain("MCP_API_KEY: ${{ secrets.MCP_API_KEY || '' }}")
    expect(master).not.toContain('VITE_MCP_API_KEY:')
  })
})
