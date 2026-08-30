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
    expect(overview).toContain('metaResult.value.success === false')
    expect(overview).toContain('googleStatusResult.value.success === false')
    expect(overview).toContain('googleResult.value.success === false')
    expect(overview).toContain('const currentToday = localDate(now)')
    expect(overview).toContain('globalThis.setInterval')
    expect(overview).toContain("period: { from: currentFrom, to: currentToday }")
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

  it('normalizes patient phones and sends WhatsApp only through the authenticated NUVANX Edge Function', () => {
    const sheet = read('../src/components/crm/LeadDetailSheet.tsx')
    expect(sheet).toContain('normalizeWhatsappPhone')
    expect(sheet).toContain("raw.replace(/\\D/g, '')")
    expect(sheet).toContain("supabase.functions.invoke('whatsapp-send'")
    expect(sheet).toContain('lead_id: lead.id')
    expect(sheet).toContain('globalThis.confirm')
    expect(sheet).toContain('Meta Cloud API')
    expect(sheet).not.toContain('api.whatsapp.com')
    expect(sheet).not.toContain('wa.me')
  })

  it('authorizes the owned lead and exact stored recipient before the irreversible Meta send', () => {
    const worker = read('../../supabase/functions/whatsapp-send/index.ts')
    expect(worker).toContain('authorizeLeadRecipient')
    expect(worker).toContain('.select("id,user_id,phone")')
    expect(worker).toContain('storedPhone !== normalizedTo')
    expect(worker).toContain('Recipient does not match the lead phone')
    const authorization = worker.indexOf('const authorized = await authorizeLeadRecipient')
    const providerSend = worker.indexOf('const waRes = await fetch')
    expect(authorization).toBeGreaterThan(-1)
    expect(providerSend).toBeGreaterThan(authorization)
  })
})
