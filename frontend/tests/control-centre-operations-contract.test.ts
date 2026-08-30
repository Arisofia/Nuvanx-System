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
    const invokeApi = read('../src/lib/invokeApi.ts')
    expect(overview.match(/timeoutMs: 18_000/g)?.length).toBe(3)
    expect(invokeApi).toContain('AbortSignal.timeout(timeoutMs)')
    expect(invokeApi).toContain('AbortSignal.any([init.signal, timeoutSignal])')
    expect(invokeApi).toContain('signal,')
  })

  it('preserves last-known-good provider data and never presents unavailable providers as confirmed zero', () => {
    const overview = read('../src/components/dashboard/OperationsOverview.tsx')
    expect(overview).toContain("type ProviderStatus = 'live' | 'stale' | 'unavailable'")
    expect(overview).toContain('last_success_at?: string | null')
    expect(overview).toContain('const meta = metaUsable ? metaEnvelope.data : prev.meta')
    expect(overview).toContain('const google = googleUsable ? googleEnvelope.data : prev.google')
    expect(overview).toContain("? money(metaSpend) : '—'")
    expect(overview).toContain("? money(googleSpend) : '—'")
    expect(overview).toContain('Las fuentes con último dato válido se conservan marcadas como STALE')
  })

  it('organizes accessible primary navigation around clinic work instead of technical pages', () => {
    const layout = read('../src/components/Layout.tsx')
    for (const label of ['Centro', 'Pacientes', 'Agenda', 'Adquisición', 'Finanzas', 'Inteligencia', 'Analítica', 'Integraciones']) {
      expect(layout).toContain(`label: '${label}'`)
    }
    expect(layout).toContain("label: 'Trazabilidad'")
    expect(layout).toContain("label: 'Auditoría leads'")
    expect(layout).toContain('systemNavItems')
    expect(layout).toContain('aria-label={item.label}')
  })

  it('renders appointment calendar dates locally and labels the WhatsApp editor accessibly', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain('function formatLocalCalendarDate')
    expect(sheet).toContain('new Date(year, month - 1, day)')
    expect(sheet).not.toContain('new Date(lead.appointment_date)')
    expect(sheet).toContain('<label htmlFor="whatsapp-draft" className="sr-only">Mensaje de WhatsApp</label>')
    expect(sheet).toContain('id="whatsapp-draft"')
  })

  it('sends WhatsApp only through the authenticated NUVANX Edge Function with an idempotency key', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain('normalizeWhatsappPhone')
    expect(sheet).toContain("raw.replace(/\\D/g, '')")
    expect(sheet).toContain("supabase.functions.invoke('whatsapp-send'")
    expect(sheet).toContain('lead_id: lead.id')
    expect(sheet).toContain('idempotency_key: intentKey')
    expect(sheet).toContain('createWhatsappIntentKey')
    expect(sheet).toContain('globalThis.confirm')
    expect(sheet).toContain('Meta Cloud API')
    expect(sheet).not.toContain('api.whatsapp.com')
    expect(sheet).not.toContain('wa.me')
  })

  it('keeps confirmation before invocation and preserves the same intent after ambiguous outcomes', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expectOrdered(
      sheet,
      'const confirmed = globalThis.confirm',
      'if (!confirmed) return',
      'const intentKey = whatsappIntentKey || createWhatsappIntentKey()',
      "supabase.functions.invoke('whatsapp-send'",
    )
    expect(sheet).toContain('if (!whatsappIntentKey) setWhatsappIntentKey(intentKey)')
    expect(sheet).toContain("providerStatus === 'failed'")
    expect(sheet).toContain('payload?.pending === true || providerStatus === \'unknown\'')
    expect(sheet).toContain('No crees un segundo envío')
  })

  it('does not claim delivery from a synchronous Meta acceptance', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain('Aceptado por Meta. Entrega pendiente de confirmación.')
    expect(sheet).toContain('aceptación de Meta y la entrega al contacto son estados diferentes')
    expect(sheet).not.toContain('Mensaje enviado correctamente.')
  })

  it('authorizes, rate-limits and reserves the exact owned recipient before the irreversible Meta send', () => {
    const worker = read('../../supabase/functions/whatsapp-send/index.ts')
    expectOrdered(
      worker,
      'const auth = await authenticatedContext(req)',
      'const prepared = await prepareSend',
      'waRes = await fetch',
    )
    expect(worker).toContain('nvx_prepare_whatsapp_send')
    expect(worker).toContain('decision === "rate_limited"')
    expect(worker).toContain('decision === "duplicate"')
    expect(worker).toContain('AbortSignal.timeout(PROVIDER_TIMEOUT_MS)')
    expect(worker).toContain('["reserved", "unknown"].includes(requestStatus)')
  })
})
