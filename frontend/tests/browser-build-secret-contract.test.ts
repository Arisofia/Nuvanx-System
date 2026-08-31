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

const frontendBuildWorkflows = { 'master.yml': master, 'deploy-cloudflare.yml': cloudflare }

// Strict allowlist of secrets permitted to be injected into browser-accessible VITE_* variables.
const ALLOWED_BROWSER_PUBLIC_SECRETS = new Set([
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SENTRY_DSN',
])

// Backend-only secrets that must never reach a browser build input (defense-in-depth).
const BACKEND_SECRETS_DENYLIST = [
  'MCP_API_KEY',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'DATABASE_URL',
  'META_REPORTING_TOKEN_60D',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_SERVICE_ACCOUNT',
  'CLOUDFLARE_API_TOKEN',
  'SHEETS_WEBHOOK_SECRET_DOCTORALIA',
]

describe('browser build secret boundary', () => {
  it('strictly restricts all VITE_* secrets to the browser-public allowlist', () => {
    const viteSecretPattern = /(VITE_[A-Z0-9_]+):\s*\$\{\{[^}]*secrets\.([A-Z0-9_]+)[^}]*\}\}/g

    for (const [workflowName, content] of Object.entries(frontendBuildWorkflows)) {
      expect(content, `${workflowName} contains legacy VITE_MCP_API_KEY`).not.toContain('VITE_MCP_API_KEY')

      let match: RegExpExecArray | null
      while ((match = viteSecretPattern.exec(content)) !== null) {
        const [fullMatch, viteVarName, secretName] = match
        expect(
          ALLOWED_BROWSER_PUBLIC_SECRETS.has(secretName),
          `In ${workflowName}: variable ${viteVarName} maps forbidden secret secrets.${secretName} (full assignment: "${fullMatch}")`,
        ).toBe(true)
      }
    }
  })

  it('explicitly guards against any backend denylist secret in VITE mappings', () => {
    for (const [workflowName, content] of Object.entries(frontendBuildWorkflows)) {
      for (const secret of BACKEND_SECRETS_DENYLIST) {
        const pattern = new RegExp(`VITE_[A-Z0-9_]+:\\s*\\$\\{\\{[^}]*secrets\\.${secret}[^}]*\\}\\}`, 'i')
        expect(content, `In ${workflowName}: exposes backend secret ${secret}`).not.toMatch(pattern)
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
