import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/20260901120000_scope_meta_account_coverage_per_owner.sql', import.meta.url),
  'utf8',
)

describe('Meta account coverage owner scoping', () => {
  it('prefers an exact user-scoped canonical integration before clinic fallback', () => {
    expect(migration).toContain('LEFT JOIN LATERAL')
    expect(migration).toContain('candidate.clinic_id IS NULL')
    expect(migration).toContain('candidate.user_id = mdi.user_id')
    expect(migration).toContain('candidate.clinic_id = mdi.clinic_id')
    expect(migration).toMatch(/WHEN candidate\.clinic_id IS NULL\s+AND candidate\.user_id = mdi\.user_id\s+THEN 0/)
    expect(migration).toContain('LIMIT 1')
  })

  it('falls back from blank adAccountId to a usable ad_account_id and excludes empty canonical ids', () => {
    expect(migration).toContain("nullif(i.metadata->>'adAccountId', '')")
    expect(migration).toContain("nullif(i.metadata->>'ad_account_id', '')")
    expect(migration).toMatch(/regexp_replace\([\s\S]*?\) <> ''/)
  })

  it('preserves security invoker and owner dimensions in the reporting view', () => {
    expect(migration).toContain('WITH (security_invoker = true)')
    expect(migration).toContain('mdi.user_id')
    expect(migration).toContain('mdi.clinic_id')
  })
})
