import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

describe('NUVANX Control Centre operations contract', () => {
  it('makes the real operations overview the dashboard entry point', () => {
    const dashboard = read('../src/pages/Dashboard.tsx')
    expect(dashboard).toContain("import { OperationsOverview }")
    expect(dashboard).toContain('<OperationsOverview />')
    expect(dashboard).toContain('Analítica y rendimiento')
  })

  it('reads patients, agenda, Meta and Google from canonical production APIs', () => {
    const overview = read('../src/components/dashboard/OperationsOverview.tsx')
    expect(overview).toContain('useLeads()')
    expect(overview).toContain('/api/agenda/doctoralia?date=')
    expect(overview).toContain('/api/meta/insights?')
    expect(overview).toContain('/api/google-ads/status')
    expect(overview).toContain('/api/google-ads/insights?')
    expect(overview).not.toMatch(/mock|fixture|demo data/i)
  })

  it('fails visibly on application-level provider errors and refreshes across day boundaries', () => {
    const overview = read('../src/components/dashboard/OperationsOverview.tsx')
    expect(overview).toContain("metaResult.status === 'fulfilled' && metaResult.value.success !== false")
    expect(overview).toContain('googleStatusResult.value.success !== false')
    expect(overview).toContain("googleResult.status === 'fulfilled' && googleResult.value.success !== false")
    expect(overview).toContain('const currentToday = localDate(now)')
    expect(overview).toContain('globalThis.setInterval')
    expect(overview).toContain("period: { from: currentFrom, to: currentToday }")
  })

  it('preserves last-known-good provider data and marks stale sources instead of presenting failures as zero', () => {
    const overview = read('../src/components/dashboard/OperationsOverview.tsx')
    expect(overview).toContain('cached?: boolean')
    expect(overview).toContain('degraded?: boolean')
    expect(overview).toContain('last_success?: string | null')
    expect(overview).toContain("metaBackendStale ? 'stale' : 'live'")
    expect(overview).toContain("prev.google && prev.googleStatus?.connected")
    expect(overview).toContain("? money(metaSpend) : '—'")
    expect(overview).toContain("? money(googleSpend) : '—'")
    expect(overview).toContain('Las fuentes con último dato válido se conservan marcadas como STALE')
  })

  it('organizes the primary navigation around clinic work instead of technical pages', () => {
    const layout = read('../src/components/Layout.tsx')
    for (const label of ['Centro', 'Pacientes', 'Agenda', 'Adquisición', 'Finanzas', 'Inteligencia', 'Analítica', 'Integraciones']) {
      expect(layout).toContain(`label: '${label}'`)
    }
    expect(layout).toContain("label: 'Trazabilidad'")
    expect(layout).toContain("label: 'Auditoría leads'")
    expect(layout).toContain('systemNavItems')
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

  it('keeps the same send intent after ambiguous network/provider outcomes and creates a new one only after editing or explicit failure', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain('whatsappIntentKey || createWhatsappIntentKey()')
    expect(sheet).toContain('if (!whatsappIntentKey) setWhatsappIntentKey(intentKey)')
    expect(sheet).toContain("providerStatus === 'failed'")
    expect(sheet).toContain('setWhatsappIntentKey(null)')
    expect(sheet).toContain('No crees un segundo envío')
  })

  it('does not claim delivery from a synchronous Meta acceptance', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain('Aceptado por Meta. Entrega pendiente de confirmación.')
    expect(sheet).toContain('aceptación de Meta y la entrega al paciente son estados diferentes')
    expect(sheet).not.toContain('Mensaje enviado correctamente.')
  })

  it('authorizes, rate-limits and reserves the exact owned recipient before the irreversible Meta send', () => {
    const worker = read('../../supabase/functions/whatsapp-send/index.ts')
    const auth = worker.indexOf('const auth = await authenticatedContext(req)')
    const reservation = worker.indexOf('const prepared = await prepareSend')
    const providerSend = worker.indexOf('waRes = await fetch')
    expect(auth).toBeGreaterThan(-1)
    expect(reservation).toBeGreaterThan(auth)
    expect(providerSend).toBeGreaterThan(reservation)
    expect(worker).toContain('nvx_prepare_whatsapp_send')
    expect(worker).toContain('decision === "rate_limited"')
    expect(worker).toContain('decision === "duplicate"')
    expect(worker).toContain('AbortSignal.timeout(PROVIDER_TIMEOUT_MS)')
  })
})
