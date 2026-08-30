import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

describe('Doctoralia three-visit journey contract', () => {
  it('keeps only true terminal stages out of the attention queue', () => {
    const overview = read('../src/components/dashboard/OperationsOverview.tsx')
    expect(overview).toContain("!['lost', 'client_completed'].includes")
    expect(overview).not.toContain("['won', 'lost', 'treatment_completed']")
  })

  it('prevents explicit clinical stages from fabricating Doctoralia progression', () => {
    const migration = read('../../supabase/migrations/20260830224128_harden_doctoralia_journey_evidence_boundaries.sql')
    expect(migration).toContain("check (explicit_stage in ('new_lead','contacted','conversation','treatment_proposed','lost'))")
    expect(migration).not.toContain("then 'client_completed' else p.explicit_stage")
  })

  it('deduplicates fallback appointments and normalizes cancellation status', () => {
    const migration = read('../../supabase/migrations/20260830224128_harden_doctoralia_journey_evidence_boundaries.sql')
    expect(migration).toContain("md5(concat_ws('|'")
    expect(migration).toContain("coalesce(nullif(btrim(a.status),''),nullif(btrim(a.estado),''),'')")
    expect(migration).toContain("'no acude','no acudió','no acudio','no_show','no show','noshow'")
  })

  it('uses Madrid appointment timestamps for same-day capture boundaries and visit order', () => {
    const migration = read('../../supabase/migrations/20260830224649_use_doctoralia_appointment_timestamp_for_journey.sql')
    expect(migration).toContain("at time zone 'Europe/Madrid'")
    expect(migration).toContain('r.appointment_at >= r.lead_created_at')
    expect(migration).toContain('d.appointment_at nulls last')
  })
})
