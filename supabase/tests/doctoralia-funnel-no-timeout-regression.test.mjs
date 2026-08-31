import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sql = readFileSync(
  fileURLToPath(new URL('../migrations/20260831173000_repair_funnel_and_source_to_cash_contracts.sql', import.meta.url)),
  'utf8',
)

describe('Doctoralia timeout regression contract', () => {
  it('does not hide the production defect by changing statement_timeout', () => {
    expect(sql.toLowerCase()).not.toContain('statement_timeout')
  })

  it('does not use migration-history repair or generated IDs', () => {
    expect(sql.toLowerCase()).not.toContain('migration repair')
    expect(sql).not.toMatch(/cron\.alter_job\s*\(\s*\d+/i)
  })
})
