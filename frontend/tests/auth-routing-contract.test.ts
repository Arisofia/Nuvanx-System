import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const appSource = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8')
const loginSource = readFileSync(fileURLToPath(new URL('../src/pages/Login.tsx', import.meta.url)), 'utf8')

describe('Control Centre authentication routing contract', () => {
  it('has one authentication owner on the login page', () => {
    expect(loginSource).toContain("import { AuthContext } from '../contexts/AuthContext'")
    expect(loginSource).toContain('const auth = useContext(AuthContext)')
    expect(loginSource).toContain('await auth.signIn(email.trim(), password)')
    expect(loginSource).not.toContain('supabase.auth.signInWithPassword')
    expect(loginSource).not.toMatch(/\b(?:useLocation|setLocation|navigate)\b|window\.location/)
  })

  it('redirects only from settled AuthContext state and replaces guard history entries', () => {
    expect(appSource).toContain('if (!auth || auth.loading) return')
    expect(appSource).toContain('if (isAuthPage && auth.isAuthenticated)')
    expect(appSource).toContain("setLocation('/dashboard', { replace: true })")
    expect(appSource).toContain('if (!isAuthPage && !auth.isAuthenticated)')
    expect(appSource).toContain("setLocation('/login', { replace: true })")
    expect(appSource).toContain('if (auth?.loading || (isAuthPage && auth?.isAuthenticated))')
  })
})
