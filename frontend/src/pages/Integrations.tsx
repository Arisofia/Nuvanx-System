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
  return serviceLabels[service] ?? service.replaceAll('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())
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

  const handleConnect = async (e: FormEvent) => {
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Integrations</h1>
          <p className="text-slate-600 mt-1">Credential vault — Meta Ads, WhatsApp, OpenAI, Gemini, GitHub, Google Ads</p>
        </div>
        <Button className="gap-2" onClick={() => { setShowForm(true); setSaveError(null) }}>
          <Plus className="w-4 h-4" />
          Add Integration
        </Button>
      </div>

      {/* ── Connect form ───────────────────────────────────────────── */}
      {showForm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Connect Integration</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}><X className="w-4 h-4" /></Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleConnect} className="space-y-3">
              <div>
                <label className="text-sm font-medium">Service</label>
                <select
                  name="service"
                  value={form.service}
                  onChange={handleFieldChange}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {SUPPORTED_SERVICES.map((s) => (
                    <option key={s} value={s}>{formatServiceName(s)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">
                  {form.service === 'meta' ? 'Meta Access Token' :
                   form.service === 'whatsapp' ? 'WhatsApp System User Token' :
                   form.service === 'google_ads' ? 'Google Ads Developer Token' :
                   'API Key / Token'}
                </label>
                <Input
                  type="password"
                  name="token"
                  placeholder="Paste your token here"
                  value={form.token}
                  onChange={handleFieldChange}
                  className="mt-1"
                />
              </div>

              {form.service === 'meta' && (
                <>
                  <div>
                    <label className="text-sm font-medium">Ad Account ID <span className="text-red-500">*</span></label>
                    <Input
                      type="text"
                      name="adAccountId"
                      placeholder="e.g. 123456789012345 or act_123456789012345"
                      value={form.adAccountId}
                      onChange={handleFieldChange}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Page ID <span className="text-slate-400 font-normal">(optional)</span></label>
                    <Input
                      type="text"
                      name="pageId"
                      placeholder="Facebook Page ID for lead webhooks"
                      value={form.pageId}
                      onChange={handleFieldChange}
                      className="mt-1"
                    />
                  </div>
                </>
              )}

              {form.service === 'whatsapp' && (
                <div>
                  <label className="text-sm font-medium">Phone Number ID <span className="text-red-500">*</span></label>
                  <Input
                    type="text"
                    name="phoneNumberId"
                    placeholder="WhatsApp Business phone number ID"
                    value={form.phoneNumberId}
                    onChange={handleFieldChange}
                    className="mt-1"
                  />
                </div>
              )}

              {saveError && <p className="text-sm text-red-600">{saveError}</p>}

              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={saving} className="flex-1">
                  {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : 'Connect'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card><CardContent className="py-6 text-sm text-slate-600">Loading integrations…</CardContent></Card>
      )}
      {error && (
        <Card className="border-red-200 bg-red-50"><CardContent className="py-6 text-sm text-red-700">{error}</CardContent></Card>
      )}
      {!loading && !error && integrations.length === 0 && (
        <Card><CardContent className="py-6 text-sm text-slate-600">No integrations connected yet. Click "Add Integration" to get started.</CardContent></Card>
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
                  <Badge className="bg-green-50 text-green-700 border-green-200">
                    <CheckCircle2 className="w-3 h-3 mr-1" />Connected
                  </Badge>
                ) : (
                  <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200">
                    <AlertCircle className="w-3 h-3 mr-1" />{integration.status || 'Inactive'}
                  </Badge>
                )}
              </CardHeader>

              <CardContent className="space-y-2">
                {adAccountId && (
                  <p className="text-xs text-slate-500">Ad Account: <span className="font-mono">{adAccountId}</span></p>
                )}
                {pageId && (
                  <p className="text-xs text-slate-500">Page ID: <span className="font-mono">{pageId}</span></p>
                )}
                {integration.last_error && (
                  <p className="text-xs text-red-600">Last error: {integration.last_error}</p>
                )}
                {integration.updated_at && (
                  <p className="text-xs text-slate-400">Updated: {new Date(integration.updated_at).toLocaleString()}</p>
                )}
                {testResult[integration.service] && (
                  <p className="text-xs text-slate-700 bg-slate-50 rounded p-2">{testResult[integration.service]}</p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  disabled={testing === integration.service}
                  onClick={() => handleTest(integration.service)}
                >
                  {testing === integration.service
                    ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Testing…</>
                    : 'Test Connection'}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

