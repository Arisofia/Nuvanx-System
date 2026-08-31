import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migration = readFileSync(
  fileURLToPath(new URL('../migrations/20260831173000_repair_funnel_and_source_to_cash_contracts.sql', import.meta.url)),
  'utf8',
)

const refreshStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.refresh_doctoralia_funnel')
const refreshEnd = migration.indexOf('-- 3. Re-run the optimized canonical owner')
const refreshBody = migration.slice(refreshStart, refreshEnd)

describe('Doctoralia funnel production-safe repair', () => {
  it('normalizes Doctoralia once through eight bounded deterministic batches', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.nvx_normalize_doctoralia_funnel_batch')
    const batchCalls = migration.match(/SELECT public\.nvx_normalize_doctoralia_funnel_batch\(/g) || []
    expect(batchCalls).toHaveLength(8)
    expect(migration).toContain('DROP FUNCTION public.nvx_normalize_doctoralia_funnel_batch(text[])')
    expect(migration).not.toMatch(/statement_timeout/i)
  })

  it('keeps the canonical owner refresh strictly owner-scoped', () => {
    expect(refreshStart).toBeGreaterThan(-1)
    expect(refreshEnd).toBeGreaterThan(refreshStart)
    expect(refreshBody).not.toContain('UPDATE public.doctoralia_appointments_ingestion')
    expect(refreshBody).toContain('AND l.user_id = p_user_id')
    expect(refreshBody).toContain('pc.funnel_status_canonical IS DISTINCT FROM l.stage_canonical')
  })

  it('does not classify a no-show valuation as attended', () => {
    expect(refreshBody).toContain('AS has_scheduled_valuation')
    expect(refreshBody).toContain('AS has_attended_valuation')
    expect(refreshBody).toContain("lower(trim(coalesce(a.estado, ''))) <> 'no acude'")
    expect(refreshBody).toContain("WHEN coalesce(r.has_attended_valuation,FALSE) THEN 'asistio'")
    expect(refreshBody).toContain("WHEN coalesce(r.has_scheduled_valuation,FALSE) THEN 'valoracion_aceptada'")
  })

  it('avoids unconditional rewrites of canonical lead and classification state', () => {
    expect(refreshBody).toContain('l.stage_canonical IS DISTINCT FROM d.desired_stage_canonical')
    expect(refreshBody).toContain('pc.funnel_status_canonical IS DISTINCT FROM l.stage_canonical')
  })
})
