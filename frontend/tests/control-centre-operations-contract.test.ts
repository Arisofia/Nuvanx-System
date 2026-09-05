import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const read = (relativePath: string) => readFileSync(new URL(relativePath, new URL(`file://${here}`)), 'utf8')

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
    const app = read('../src/App.tsx')
    expect(app).toContain('<Route index element={<OperationsOverview />} />')
    expect(app).toContain('<Route path="crm" element={<CrmDashboard />} />')
    expect(app).toContain('<Route path="agenda" element={<AgendaDashboard />} />')
    expect(app).toContain('<Route path="marketing" element={<MarketingUnified />} />')
  })

  it('reads CRM, agenda, Meta and Google through canonical production owners', () => {
    const overview = read('../src/pages/OperationsOverview.tsx')
    expect(overview).toContain("path: '/api/crm/summary'")
    expect(overview).toContain("path: '/api/agenda/summary'")
    expect(overview).toContain("path: '/api/meta/insights'")
    expect(overview).toContain("path: '/api/google-ads/insights'")
  })

  it('keeps CRM clinical progress on the canonical three-visit Doctoralia journey', () => {
    const overview = read('../src/pages/OperationsOverview.tsx')
    const crm = read('../src/pages/CrmDashboard.tsx')
    for (const source of [overview, crm]) {
      expect(source).toContain('valoracion_confirmada')
      expect(source).toContain('procedimiento_realizado')
      expect(source).toContain('post_procedimiento_confirmado')
      expect(source).toContain('Tercera cita')
      expect(source).not.toContain("'valoracion_confirmada', 'procedimiento_realizado', 'convertido'")
    }
  })

  it('cancels canonical and optional CRM requests cleanly when the view unmounts', () => {
    const overview = read('../src/pages/OperationsOverview.tsx')
    expect(overview).toContain('const controller = new AbortController()')
    expect(overview).toContain('signal: controller.signal')
    expect(overview).toContain('return () => controller.abort()')
  })

  it('fails visibly on unavailable provider envelopes and refreshes across day boundaries', () => {
    const overview = read('../src/pages/OperationsOverview.tsx')
    expect(overview).toContain("providerState !== 'ok'")
    expect(overview).toContain('setTimeout(() => setRangeNonce')
    expect(overview).toContain('nextMadridDayBoundaryMs()')
  })

  it('bounds every gateway request below the provider budget', () => {
    const overview = read('../src/pages/OperationsOverview.tsx')
    expect(overview).toContain('AbortSignal.timeout')
  })

  it('preserves last-known-good provider data and never presents unavailable providers as confirmed zero', () => {
    const overview = read('../src/pages/OperationsOverview.tsx')
    expect(overview).toContain('lastKnownGood')
    expect(overview).toContain('Datos no disponibles')
  })

  it('organizes accessible primary navigation around clinic work instead of technical pages', () => {
    const layout = read('../src/components/layout/AppLayout.tsx')
    expect(layout).toContain('aria-label="Navegación principal"')
    expect(layout).toContain("label: 'Operaciones'")
    expect(layout).toContain("label: 'CRM'")
    expect(layout).toContain("label: 'Agenda'")
    expect(layout).toContain("label: 'Marketing'")
  })

  it('renders appointment calendar dates locally and labels the WhatsApp editor accessibly', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain("aria-label=\"Mensaje de WhatsApp\"")
    expect(sheet).not.toContain('toISOString().split')
  })

  it('sends WhatsApp only through the authenticated NUVANX Edge Function with an idempotency key', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain("supabase.functions.invoke('whatsapp-send'")
    expect(sheet).toContain('idempotencyKey: intentKey')
    expect(sheet).not.toContain('graph.facebook.com')
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

  it('never claims delivery merely because an enqueue request succeeded', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain('aceptación de Meta y la entrega al contacto son estados diferentes')
    expect(sheet).not.toContain('Mensaje enviado correctamente.')
  })

  it('authorizes, encrypts and queues before async provider delivery', () => {
    const enqueue = read('../../supabase/functions/whatsapp-send/index.ts')
    const worker = read('../../supabase/functions/whatsapp-outbound-worker/index.ts')
    const provider = read('../../supabase/functions/_shared/whatsapp-provider.ts')
    expectOrdered(
      enqueue,
      'const auth = await authenticatedContext(req)',
      'encrypted = await encryptMessage(message, leadId, messageSha256)',
      'const prepared = await prepareSendAsync(',
    )
    expect(enqueue).toContain('nvx_prepare_whatsapp_send_async')
    expect(enqueue).toContain('decision === "rate_limited"')
    expect(enqueue).toContain('decision === "duplicate"')
    expect(enqueue).toContain('providerStatus: "queued"')
    expect(enqueue).not.toContain('graph.facebook.com')
    expectOrdered(
      worker,
      'message = await decryptMessage(row, keyring)',
      'await markSending(admin, row)',
      'const outcome = await sendWhatsAppText',
    )
    expect(worker).not.toContain('graph.facebook.com')
    expect(provider).toContain('AbortSignal.timeout(timeoutMs)')
    expect(provider).toContain('if (!providerMessageId)')
    expect(provider).toContain('https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages')
  })
})
