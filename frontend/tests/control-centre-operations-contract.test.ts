import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

function expectOrdered(source: string, ...anchors: string[]) {
  let previous = -1
  for (const anchor of anchors) {
    const current = source.indexOf(anchor)
    expect(current, `missing anchor: ${anchor}`).toBeGreaterThan(-1)
    expect(current, `out-of-order anchor: ${anchor}`).toBeGreaterThan(previous)
    previous = current
  }
}

describe('NUVANX Control Centre operations contract', () => {
  it('makes the real operations overview the dashboard entry point', () => {
    const dashboard = read('../src/pages/Dashboard.tsx')
    expect(dashboard).toContain("import { OperationsOverview }")
    expect(dashboard).toContain('<OperationsOverview />')
    expect(dashboard).toContain('Analítica y rendimiento')
  })

  it('reads CRM, agenda, Meta and Google through canonical production owners', () => {
    const overview = read('../src/components/dashboard/OperationsOverview.tsx')
    expect(overview).toContain('useLeads()')
    expect(overview).toContain('/control-centre-provider?provider=agenda&date=')
    expect(overview).toContain('/control-centre-provider?provider=meta&')
    expect(overview).toContain('/control-centre-provider?provider=google&')
    expect(overview).not.toContain('/api/meta/insights?')
    expect(overview).not.toContain('/api/google-ads/status')
    expect(overview).not.toContain('/api/google-ads/insights?')
    expect(overview).not.toMatch(/mock|fixture|demo data/i)
  })

  it('keeps CRM clinical progress on the canonical three-visit Doctoralia journey', () => {
    const hook = read('../src/hooks/useLeads.ts')
    const crm = read('../src/pages/CRM.tsx')
    const pipeline = read('../src/lib/pipeline.ts')

    expect(hook).toContain("supabase.rpc('nvx_get_control_centre_pipeline'")
    expect(hook).toContain('journey_appointment_count')
    expect(hook).toContain('fetchOptionalLeadMetadata')
    expect(hook).toContain('return new Map()')
    expectOrdered(
      hook,
      'const pipelineRows = await fetchCanonicalPipeline(context?.signal)',
      'const rawById = await fetchOptionalLeadMetadata(context?.signal)',
    )
    expect(hook).toContain('query.abortSignal(signal)')
    expect(hook).toContain('if (context?.signal?.aborted || (context && !context.active)) return')
    expect(hook).not.toContain('resolveCanonicalStage')
    expect(hook).not.toContain('apiUpdates.stage = apiUpdates.status')
    expect(hook).not.toContain('Promise.all([')

    expect(crm).toContain('1/3 · Valoración')
    expect(crm).toContain('2/3 · Tratamiento')
    expect(crm).toContain('3/3 · 1er control')
    expect(crm).toContain('Clientes nuevos')
    expect(crm).toContain('El nombre de la cita puede ser “revisión”')
    expect(crm).not.toContain("import { KanbanBoard }")

    expect(pipeline).toContain("{ id: 'control_scheduled', label: '1er control programado' }")
    expect(pipeline).toContain("{ id: 'client_completed', label: 'Cliente nuevo · ciclo completado' }")
    expect(pipeline).not.toContain("{ id: 'won', label: 'Ganado' }")
  })

  it('cancels canonical and optional CRM requests cleanly when the view unmounts', () => {
    const hook = read('../src/hooks/useLeads.ts')
    expect(hook).toContain('const controller = new AbortController()')
    expect(hook).toContain('fetchCanonicalPipeline(context?.signal)')
    expect(hook).toContain('query.abortSignal(signal)')
    expect(hook).toContain("invokeApi<{ leads?: Record<string, unknown>[] }>('/api/leads', { signal })")
    expect(hook).toContain('if (signal?.aborted) return new Map()')
    expectOrdered(
      hook,
      'context.active = false',
      'controller.abort()',
      'clearTimeout(timer)',
    )
  })

  it('fails visibly on unavailable provider envelopes and refreshes across day boundaries', () => {
    const overview = read('../src/components/dashboard/OperationsOverview.tsx')
    expect(overview).toContain('function envelopeUsable')
    expect(overview).toContain('function resolveEnvelopeHealth')
    expect(overview).toContain("value.status === 'live' || value.status === 'stale'")
    expect(overview).toContain("status: hasPrevious ? 'stale' : 'error'")
    expect(overview).toContain('const currentToday = localDate(now)')
    expect(overview).toContain('globalThis.setInterval')
    expect(overview).toContain("period: { from: currentFrom, to: currentToday }")
  })

  it('bounds every gateway request below the provider budget', () => {
    const overview = read('../src/components/dashboard/OperationsOverview.tsx')
    expect(overview).toContain('AbortSignal.timeout')
  })

  it('preserves last-known-good provider data and never presents unavailable providers as confirmed zero', () => {
    const overview = read('../src/components/dashboard/OperationsOverview.tsx')
    expect(overview).toContain('stale')
  })

  it('organizes accessible primary navigation around clinic work instead of technical pages', () => {
    const navigation = read('../src/components/layout/Sidebar.tsx')
    expect(navigation).toContain('Pacientes')
    expect(navigation).toContain('Agenda')
  })

  it('renders appointment calendar dates locally and labels the WhatsApp editor accessibly', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain('toLocaleDateString')
    expect(sheet).toContain('whatsapp-draft')
  })

  it('sends WhatsApp only through the authenticated NUVANX Edge Function with an idempotency key', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain("supabase.functions.invoke('whatsapp-send'")
    expect(sheet).toContain('idempotency_key')
  })

  it('keeps confirmation before invocation and preserves the same intent after ambiguous outcomes', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expectOrdered(sheet, 'globalThis.confirm', "supabase.functions.invoke('whatsapp-send'")
    expect(sheet).toContain('setWhatsappIntentKey')
  })

  it('does not claim delivery from a synchronous Meta acceptance', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain('Aceptado por Meta. Entrega pendiente de confirmación')
  })

  it('authorizes, rate-limits and reserves the exact owned recipient before the irreversible Meta send', () => {
    const source = read('../../supabase/functions/whatsapp-send/index.ts')
    expectOrdered(source, 'authenticatedContext(req)', 'prepareSend(', 'await fetch(')
  })
})
