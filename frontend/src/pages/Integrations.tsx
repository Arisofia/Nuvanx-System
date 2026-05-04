import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { CheckCircle2, AlertCircle, Plus, X, Loader2 } from 'lucide-react'
import { invokeApi, supabase } from '../lib/supabaseClient'
import type { IntegrationRow, ConnectForm } from '../types'

const serviceIcons: Record<string, string> = {
  meta: '📱',
  whatsapp: '💬',
  google_ads: '🔍',
  openai: '🤖',
  gemini: '✨',
  github: '🐙',
  doctoralia: '🏥',
}

const serviceLabels: Record<string, string> = {
  meta: 'Meta Ads',
  whatsapp: 'WhatsApp Business',
  google_ads: 'Google Ads',
  openai: 'OpenAI',
  gemini: 'Gemini',
  github: 'GitHub',
  doctoralia: 'Doctoralia',
}

function formatServiceName(service: string) {
  const label = serviceLabels[service] ?? service.replaceAll('_', ' ')
  return label
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const SUPPORTED_SERVICES = ['meta', 'whatsapp', 'openai', 'gemini', 'github', 'google_ads']

export default function Integrations() {
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ConnectForm>({ service: 'meta', token: '', adAccountId: '', pageId: '', phoneNumberId: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  async function loadIntegrations() {
    setLoading(true)
    setError(null)
    const { data, error: queryError } = await supabase
      .from('integrations')
      .select('*')
      .order('service', { ascending: true })
    if (queryError) {
      setError(queryError.message)
      setIntegrations([])
    } else {
      setIntegrations((data ?? []) as IntegrationRow[])
    }
    setLoading(false)
  }

  useEffect(() => { loadIntegrations() }, [])

  const handleFieldChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleConnect = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaveError(null)
    if (!form.token.trim()) { setSaveError('Token / API key is required.'); return }
    if (form.service === 'meta' && !form.adAccountId.trim()) { setSaveError('Ad Account ID is required for Meta.'); return }

    const metadata: Record<string, string> = {}
    if (form.service === 'meta') {
      metadata.adAccountId = form.adAccountId.trim()
      if (form.pageId.trim()) metadata.pageId = form.pageId.trim()
    }
    if (form.service === 'whatsapp') {
      metadata.phoneNumberId = form.phoneNumberId.trim()
    }

    setSaving(true)
    try {
      await invokeApi('/integrations/connect', {
        method: 'POST',
        body: { service: form.service, token: form.token.trim(), metadata },
      })
      setShowForm(false)
      setForm({ service: 'meta', token: '', adAccountId: '', pageId: '', phoneNumberId: '' })
      await loadIntegrations()
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to connect integration.')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (service: string) => {
    setTesting(service)
    setTestResult((prev) => ({ ...prev, [service]: '' }))
    try {
      const res: any = await invokeApi('/integrations/test', {
        method: 'POST',
        body: { service },
      })
      setTestResult((prev) => ({ ...prev, [service]: res?.message ?? (res?.success ? 'OK' : 'Error') }))
    } catch (err: any) {
      setTestResult((prev) => ({ ...prev, [service]: err?.message ?? 'Test failed' }))
    } finally {
      setTesting(null)
    }
  }

  let tokenLabel = 'API Key / Token'
  if (form.service === 'meta') {
    tokenLabel = 'Token de Acceso de Meta'
  } else if (form.service === 'whatsapp') {
    tokenLabel = 'Token de Usuario del Sistema de WhatsApp'
  } else if (form.service === 'google_ads') {
    tokenLabel = 'Token de Desarrollador de Google Ads'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Integraciones</h1>
          <p className="text-muted mt-1">Bóveda de credenciales — Meta Ads, WhatsApp, OpenAI, Gemini, GitHub, Google Ads</p>
          <p className="text-xs text-muted mt-1">
            Inicia sesión con credenciales reales y consulta <a href="mailto:support@nuvanx.com" className="text-primary underline">support@nuvanx.com</a> si necesitas ayuda con tokens.
          </p>
        </div>
        <Button className="gap-2" onClick={() => { setShowForm(true); setSaveError(null) }}>
          <Plus className="w-4 h-4" />
          Agregar integración
        </Button>
      </div>

      {/* ── Connect form ───────────────────────────────────────────── */}
      {showForm && (
        <Card className="border-border bg-surface">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Conectar Integración</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}><X className="w-4 h-4" /></Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleConnect} className="space-y-3">
              <div>
                <label htmlFor="service-select" className="text-sm font-medium">Servicio</label>
                <select
                  id="service-select"
                  name="service"
                  value={form.service}
                  onChange={handleFieldChange}
                  className="mt-1 w-full rounded-md border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {SUPPORTED_SERVICES.map((s) => (
                    <option key={s} value={s}>{formatServiceName(s)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="token-input" className="text-sm font-medium">
                  {tokenLabel}
                </label>
                <Input
                  id="token-input"
                  type="password"
                  name="token"
                  placeholder="Pega tu token aquí"
                  value={form.token}
                  onChange={handleFieldChange}
                  className="mt-1"
                />
              </div>

              {form.service === 'meta' && (
                <>
                  <div>
                    <label htmlFor="adAccountId-input" className="text-sm font-medium">ID de la Cuenta Publicitaria <span className="text-red-500">*</span></label>
                    <Input
                      id="adAccountId-input"
                      type="text"
                      name="adAccountId"
                      placeholder="ej. 123456789012345 o act_123456789012345"
                      value={form.adAccountId}
                      onChange={handleFieldChange}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label htmlFor="pageId-input" className="text-sm font-medium">ID de la Página <span className="text-muted font-normal">(opcional)</span></label>
                    <Input
                      id="pageId-input"
                      type="text"
                      name="pageId"
                      placeholder="ID de la página de Facebook para webhooks de leads"
                      value={form.pageId}
                      onChange={handleFieldChange}
                      className="mt-1"
                    />
                  </div>
                </>
              )}

              {form.service === 'whatsapp' && (
                <div>
                  <label htmlFor="phoneNumberId-input" className="text-sm font-medium">ID del Número de Teléfono <span className="text-red-500">*</span></label>
                  <Input
                    id="phoneNumberId-input"
                    type="text"
                    name="phoneNumberId"
                    placeholder="ID del número de teléfono de WhatsApp Business"
                    value={form.phoneNumberId}
                    onChange={handleFieldChange}
                    className="mt-1"
                  />
                </div>
              )}

              {saveError && <p className="text-sm text-[#D9534F]">{saveError}</p>}

              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={saving} className="flex-1">
                  {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando…</> : 'Conectar'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card><CardContent className="py-6 text-sm text-muted">Cargando integraciones…</CardContent></Card>
      )}
      {error && (
        <Card className="border-[#D9534F]/30 bg-[#D9534F]/8"><CardContent className="py-6 text-sm text-[#D9534F]">{error}</CardContent></Card>
      )}
      {!loading && !error && integrations.length === 0 && (
        <Card><CardContent className="py-6 text-sm text-muted">No hay integraciones conectadas aún. Haz clic en "Agregar integración" para comenzar.</CardContent></Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {integrations.map((integration) => {
          const isConnected = integration.status === 'connected' || integration.status === 'active'
          const icon = serviceIcons[integration.service] ?? '🔗'
          const meta = integration.metadata ?? {}
          const adAccountId = (meta.adAccountId ?? meta.ad_account_id ?? '') as string
          const pageId = (meta.pageId ?? meta.page_id ?? '') as string

          return (
            <Card key={integration.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">
                  {icon} {formatServiceName(integration.service)}
                </CardTitle>
                {isConnected ? (
                  <Badge className="bg-[#28A745]/10 text-[#28A745] border border-[#28A745]/30">
                    <CheckCircle2 className="w-3 h-3 mr-1" />Conectado
                  </Badge>
                ) : (
                  <Badge className="bg-[#E0A020]/10 text-[#E0A020] border border-[#E0A020]/30">
                    <AlertCircle className="w-3 h-3 mr-1" />{integration.status || 'Inactivo'}
                  </Badge>
                )}
              </CardHeader>

              <CardContent className="space-y-2">
                {adAccountId && (
                  <p className="text-xs text-muted">Cuenta Publicitaria: <span className="font-mono">{adAccountId}</span></p>
                )}
                {pageId && (
                  <p className="text-xs text-muted">ID de la Página: <span className="font-mono">{pageId}</span></p>
                )}
                {integration.last_error && (
                  <p className="text-xs text-[#D9534F]">Último error: {integration.last_error}</p>
                )}
                {integration.updated_at && (
                  <p className="text-xs text-muted">Actualizado: {new Date(integration.updated_at).toLocaleString()}</p>
                )}
                {testResult[integration.service] && (
                  <p className="text-xs text-foreground bg-card rounded p-2">{testResult[integration.service]}</p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  disabled={testing === integration.service}
                  onClick={() => handleTest(integration.service)}
                >
                  {testing === integration.service
                    ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Probando…</>
                    : 'Probar Conexión'}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

