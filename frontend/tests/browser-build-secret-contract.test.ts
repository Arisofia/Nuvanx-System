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
const runtime = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/control-centre-runtime.yml', import.meta.url)),
  'utf8',
)

const frontendBuildWorkflows = {
  'master.yml': master,
  'deploy-cloudflare.yml': cloudflare,
  'control-centre-runtime.yml': runtime,
}

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

// Matches VITE_VAR: ${{ secrets.FOO }}, VITE_VAR: '${{ secrets.FOO }}', VITE_VAR: "${{ secrets.FOO || secrets.BAR }}", etc.
export function extractViteSecretAssignments(workflowContent: string): Array<{ fullMatch: string; viteVar: string; secretName: string }> {
  const linePattern = /(VITE_[A-Z0-9_]+):\s*(['"])?\s*\$\{\{([\s\S]*?)\}\}\s*\2?/g
  const secretPattern = /secrets\.([A-Z0-9_]+)/g
  const matches: Array<{ fullMatch: string; viteVar: string; secretName: string }> = []
  
  const allLines = [...workflowContent.matchAll(linePattern)]
  for (const lineMatch of allLines) {
    const fullMatch = lineMatch[0]
    const viteVar = lineMatch[1]
    const expression = lineMatch[3]
    
    const secretMatches = [...expression.matchAll(secretPattern)]
    for (const secretMatch of secretMatches) {
      matches.push({
        fullMatch,
        viteVar,
        secretName: secretMatch[1],
      })
    }
  }
  return matches
}

describe('browser build secret boundary', () => {
  it('strictly restricts all VITE_* secrets to the browser-public allowlist across all build workflows', () => {
    for (const [workflowName, content] of Object.entries(frontendBuildWorkflows)) {
      expect(content, `${workflowName} contains legacy VITE_MCP_API_KEY`).not.toContain('VITE_MCP_API_KEY')

      const assignments = extractViteSecretAssignments(content)
      for (const { fullMatch, viteVar, secretName } of assignments) {
        expect(
          ALLOWED_BROWSER_PUBLIC_SECRETS.has(secretName),
          `In ${workflowName}: variable ${viteVar} maps forbidden secret secrets.${secretName} (assignment: "${fullMatch}")`,
        ).toBe(true)
      }
    }
  })

  it('explicitly guards against any backend denylist secret in VITE mappings with word boundary (fail-closed)', () => {
    for (const [workflowName, content] of Object.entries(frontendBuildWorkflows)) {
      for (const secret of BACKEND_SECRETS_DENYLIST) {
        // Denylist uses aggressive lax pattern to prevent false negatives even with malformed quotes
        const pattern = new RegExp(`VITE_[A-Z0-9_]+:\\s*['"]?\\s*\\$\\{\\{[\\s\\S]*?secrets\\.${secret}(?:\\b|[^A-Z0-9_])[\\s\\S]*?\\}\\}\\s*['"]?`, 'i')
        expect(content, `In ${workflowName}: exposes backend secret ${secret}`).not.toMatch(pattern)
      }
    }
  })

  it('detects quoted, unquoted, and fallback expressions for secret leakage in synthetic snippets', () => {
    const syntheticSnippets = [
      "VITE_LEAK: ${{ secrets.MCP_API_KEY }}",
      "VITE_LEAK: '${{ secrets.MCP_API_KEY }}'",
      'VITE_LEAK: "${{ secrets.MCP_API_KEY }}"',
      "VITE_LEAK: '${{ secrets.MCP_API_KEY || \"\" }}'",
      'VITE_LEAK: "${{ \'\' || secrets.MCP_API_KEY }}"',
      'VITE_LEAK: "${{ secrets.VITE_SENTRY_DSN || secrets.MCP_API_KEY }}"',
      'VITE_LEAK: "${{ secrets.MCP_API_KEY || secrets.VITE_SENTRY_DSN }}"',
      'VITE_LEAK:   "   ${{ secrets.JWT_SECRET }}   "',
    ]
    for (const snippet of syntheticSnippets) {
      const extracted = extractViteSecretAssignments(snippet)
      expect(extracted.length, `Failed to extract from snippet: ${snippet}`).toBeGreaterThanOrEqual(1)
      const hasForbiddenSecret = extracted.some((item) => !ALLOWED_BROWSER_PUBLIC_SECRETS.has(item.secretName))
      expect(hasForbiddenSecret, `Expected snippet to contain forbidden secret: ${snippet}`).toBe(true)
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
