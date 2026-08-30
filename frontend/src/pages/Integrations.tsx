import { useEffect, useState, type ChangeEvent, type SyntheticEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { CheckCircle2, AlertCircle, AlertTriangle, Plus, X, Loader2 } from 'lucide-react'
import { invokeApi } from '../lib/invokeApi'
import type { IntegrationRow, IntegrationHealthStatus, ConnectForm } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Health resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the real operational health of an integration row.
 *
 * 'ok'          → status is connected/active AND last_sync is populated
 * 'degraded'    → status says connected/active but runtime evidence is missing
 *                 (null last_sync, or Google Ads with no service account proof)
 * 'disconnected'→ any other status
 *
 * This fixes the audit finding: Google Ads showed "Conectado · 908-454-0447"
 * while GOOGLE_ADS_SERVICE_ACCOUNT was absent in runtime and last_sync = NULL.
 */
function resolveIntegrationHealth(integration: IntegrationRow): IntegrationHealthStatus {
  const isStatusConnected =
    integration.status === 'connected' || integration.status === 'active'

  if (!isStatusConnected) return 'disconnected'

  // Google Ads: we know from the audit that last_sync = NULL in production
  // even when status = 'connected'. Treat as degraded unless last_sync exists.
  if (integration.service === 'google_ads') {
    if (!integration.last_sync && !integration.metadata?.last_sync) {
      return 'degraded'
    }
  }

  // Generic rule: a credential that has never successfully synced is degraded.
  if (!integration.last_sync) return 'degraded'

  return 'ok'
}

function healthLabel(health: IntegrationHealthStatus): string {
  switch (health) {
    case 'ok':
      return 'Conectado'
    case 'degraded':
      return 'Configurado · Runtime incompleto'
    case 'disconnected':
      return 'Desconectado'
  }
}

function healthDegradedReason(integration: IntegrationRow): string | null {
  if (integration.service === 'google_ads') {
    if (!integration.last_sync && !integration.metadata?.last_sync) {
      return 'Service account pendiente de configuración en el runtime del servidor. last_sync = NULL.'
    }
  }
  if (!integration.last_sync) {
    return 'Credencial guardada pero nunca se completó una sincronización real.'
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta deduplication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The DB contains two integration rows for Meta:
 *   service = 'meta'      → disconnected (act_9523... + act_4172...)
 *   service = 'meta_ads'  → connected    (act_718...)
 *
 * The backend prefers 'meta_ads' over 'meta'. The UI must reflect this
 * and warn when both exist because the canonical operational account differs
 * from the accounts shown in the Intelligence screen.
 *
 * This function groups them and returns a flag if divergence is detected.
 */
function detectMetaDivergence(integrations: IntegrationRow[]): {
  hasDivergence: boolean
  operationalAdAccountId: string | null
  legacyAdAccountIds: string[]
} {
  const metaAds = integrations.find((i) => i.service === 'meta_ads')
  const metaLegacy = integrations.find((i) => i.service === 'meta')

  const getAccountIds = (row: IntegrationRow | undefined): string[] => {
    if (!row?.metadata) return []
    const raw =
      row.metadata.adAccountIds ??
      row.metadata.ad_account_ids ??
      row.metadata.adAccountId ??
      row.metadata.ad_account_id ??
      ''
    const arr = Array.isArray(raw) ? raw : [raw]
    return arr.map((v) => String(v)).filter(Boolean)
  }

  const operationalIds = getAccountIds(metaAds)
  const legacyIds = getAccountIds(metaLegacy)

  const hasDivergence =
    metaAds !== undefined &&
    metaLegacy !== undefined &&
    legacyIds.length > 0 &&
    !legacyIds.every((id) => operationalIds.includes(id))

  return {
    hasDivergence,
    operationalAdAccountId: operationalIds[0] ?? null,
    legacyAdAccountIds: legacyIds,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

const serviceIcons: Record<string, string> = {
  meta: '📱',
  meta_ads: '📱',
  whatsapp: '💬',
  google_ads: '🔍',
  openai: '🤖',
  gemini: '✨',
  github: '🐙',
  doctoralia: '🏥',
}

const serviceLabels: Record<string, string> = {
  meta: 'Meta Ads (legacy)',
  meta_ads: 'Meta Ads',
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

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function Integrations() {
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ConnectForm>({
    service: 'meta',
    token: '',
    adAccountId: '',
    pageId: '',
    pixelId: '',
    phoneNumberId: '',
    googleAdsCustomerId: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  const [healthLoading, setHealthLoading] = useState<string | null>(null)
  const [healthResult, setHealthResult] = useState<Record<string, string>>({})

  async function loadIntegrations() {
    setLoading(true)
    setError(null)
    try {
      const res: { integrations?: IntegrationRow[] } | null = await invokeApi('/api/integrations')
      setIntegrations((res?.integrations ?? []) as IntegrationRow[])
    } catch (err: unknown) {
      console.error('[Integrations] load error (sanitized for UI):', err)
      setError(
        'No se pudieron cargar las integraciones. Recarga la página o contacta a support@nuvanx.com.'
      )
      setIntegrations([])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadIntegrations()
  }, [])

  const handleFieldChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const normalizeMetaAdAccountIds = (value: string) => {
    const ids = Array.from(
      new Set(
        String(value)
          .split(/[\s,;]+/)
          .map((segment) => segment.trim())
          .filter(Boolean)
      )
    )
    return ids
      .map((id) => {
        const cleaned = id.toLowerCase().startsWith('act_') ? id.slice(4) : id
        const digits = String(cleaned).replaceAll(/\D/g, '')
        return digits ? `act_${digits}` : ''
      })
      .filter((id, index, arr) => id && arr.indexOf(id) === index)
  }

  const extractAdAccountIds = (raw: unknown) => {
    if (Array.isArray(raw)) return normalizeMetaAdAccountIds(raw.join(' '))
    if (typeof raw === 'string' || typeof raw === 'number')
      return normalizeMetaAdAccountIds(String(raw))
    return []
  }

  const getValidationError = () => {
    if (!form.token.trim()) return 'Token / API key is required.'
    if (form.service === 'meta') {
      if (!form.adAccountId.trim()) return 'Ad Account ID is required for Meta.'
      const adAccountIds = normalizeMetaAdAccountIds(form.adAccountId)
      if (adAccountIds.length === 0) {
        return 'Ingrese al menos un ID de cuenta publicitaria válido (act_1234567890 o 1234567890).'
      }
    }
    if (form.service === 'google_ads') {
      if (!form.googleAdsCustomerId?.trim()) return 'Customer ID is required for Google Ads.'
    }
    return null
  }

  const getMetadata = () => {
    const metadata: Record<string, unknown> = {}
    if (form.service === 'meta') {
      const adAccountIds = normalizeMetaAdAccountIds(form.adAccountId)
      metadata.adAccountIds = adAccountIds
      metadata.adAccountId = adAccountIds[0]
      metadata.pageId = form.pageId.trim()
      if (form.pixelId?.trim()) metadata.pixelId = form.pixelId.trim()
    } else if (form.service === 'whatsapp') {
      metadata.phoneNumberId = form.phoneNumberId.trim()
    } else if (form.service === 'google_ads') {
      metadata.customerId = form.googleAdsCustomerId?.trim()
    }
    return metadata
  }

  const handleConnect = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaveError(null)
    const validationError = getValidationError()
    if (validationError) {
      setSaveError(validationError)
      return
    }
    setSaving(true)
    try {
      await invokeApi('/api/integrations/connect', {
        method: 'POST',
        body: { service: form.service, token: form.token.trim(), metadata: getMetadata() },
      })
      setShowForm(false)
      setForm({
        service: 'meta',
        token: '',
        adAccountId: '',
        pageId: '',
        pixelId: '',
        phoneNumberId: '',
        googleAdsCustomerId: '',
      })
      await loadIntegrations()
      if (form.service === 'meta') await handleHealthCheck('meta')
    } catch (err: unknown) {
      console.error('[Integrations] connect error (sanitized):', err)
      setSaveError(
        'Error al conectar la integración. Verifica el token/ID e intenta de nuevo, o contacta soporte.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (service: string) => {
    setTesting(service)
    setTestResult((prev) => ({ ...prev, [service]: '' }))
    try {
      const res: { message?: string; success?: boolean } = await invokeApi(
        '/api/integrations/test',
        { method: 'POST', body: { service } }
      )
      setTestResult((prev) => ({
        ...prev,
        [service]: res?.message ?? (res?.success ? 'OK' : 'Error'),
      }))
    } catch (err: unknown) {
      console.error('[Integrations] test error (sanitized):', err)
      setTestResult((prev) => ({
        ...prev,
        [service]: 'Error en la prueba de conexión. Revisa las credenciales.',
      }))
    } finally {
      setTesting(null)
    }
  }

  const handleHealthCheck = async (service: string) => {
    if (service !== 'meta') return
    setHealthLoading(service)
    setHealthResult((prev) => ({ ...prev, [service]: '' }))
    try {
      const res: Record<string, unknown> = await invokeApi('/api/health/meta')
      const account = String(res.ad_account ?? res.accountId ?? '')
      const accountIds = Array.isArray(res.accountIds)
        ? (res.accountIds as string[])
        : String(res.accountIds ?? '')
            .split(/[\s,;]+/)
            .filter(Boolean)
      const name = String(res.meta_user ?? res.metaUser ?? 'Meta user')
      const accountText = account ? ` · Cuenta: ${account}` : ''
      const accountIdsText = accountIds.length > 0 ? ` · Cuentas: ${accountIds.join(', ')}` : ''
      setHealthResult((prev) => ({
        ...prev,
        [service]: `OK: ${name}${accountText}${accountIdsText}`,
      }))
    } catch (err: unknown) {
      console.error('[Integrations] health/meta error (sanitized):', err)
      setHealthResult((prev) => ({
        ...prev,
        [service]:
          'Verificación falló. Asegúrate de que las credenciales de Meta viajen correctamente al backend.',
      }))
    } finally {
      setHealthLoading(null)
    }
  }

  let tokenLabel = 'API Key / Token'
  if (form.service === 'meta') tokenLabel = 'Token de Acceso de Meta'
  else if (form.service === 'whatsapp') tokenLabel = 'Token de Usuario del Sistema de WhatsApp'
  else if (form.service === 'google_ads') tokenLabel = 'Token de Desarrollador de Google Ads'

  // Compute Meta divergence once across all integrations
  const metaDivergence = detectMetaDivergence(integrations)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Integraciones</h1>
          <p className="text-muted mt-1">
            Panel de salud operacional — Meta Ads, WhatsApp, OpenAI, Gemini, GitHub, Google Ads
          </p>
          <p className="text-xs text-muted mt-1">
            "Conectado" indica credencial guardada + sincronización real confirmada.
            "Configurado · Runtime incompleto" significa credencial guardada pero sin evidencia de
            ejecución real.
          </p>
        </div>
        <Button
          className="gap-2"
          onClick={() => {
            setShowForm(true)
            setSaveError(null)
          }}
        >
          <Plus className="w-4 h-4" />
          Agregar integración
        </Button>
      </div>

      {/* ── Meta divergence warning ───────────────────────────────────────── */}
      {!loading && metaDivergence.hasDivergence && (
        <div className="rounded-xl border border-[#D9534F]/30 bg-[#D9534F]/8 px-4 py-3 text-sm text-foreground space-y-1">
          <p className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#D9534F]" />
            Divergencia de cuentas Meta detectada
          </p>
          <p className="text-xs text-muted">
            El backend opera con{' '}
            <span className="font-mono text-foreground">
              {metaDivergence.operationalAdAccountId ?? '(desconocida)'}
            </span>{' '}
            (integración <code>meta_ads</code>), pero la integración <code>meta</code> (legacy)
            apunta a{' '}
            <span className="font-mono text-foreground">
              {metaDivergence.legacyAdAccountIds.join(', ')}
            </span>
            . La pantalla de Inteligencia puede estar usando las cuentas legacy. Elimina o
            desactiva la integración <code>meta</code> para resolver la ambigüedad.
          </p>
        </div>
      )}

      {/* ── Connect form ──────────────────────────────────────────────────── */}
      {showForm && (
        <Card className="border-border bg-surface">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Conectar Integración</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              <X className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleConnect(e)} className="space-y-3">
              <div>
                <label htmlFor="service-select" className="text-sm font-medium">
                  Servicio
                </label>
                <select
                  id="service-select"
                  name="service"
                  value={form.service}
                  onChange={handleFieldChange}
                  className="mt-1 w-full rounded-md border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {SUPPORTED_SERVICES.map((s) => (
                    <option key={s} value={s}>
                      {formatServiceName(s)}
                    </option>
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
                    <label htmlFor="adAccountId-input" className="text-sm font-medium">
                      ID de la Cuenta Publicitaria <span className="text-red-500">*</span>
                    </label>
                    <Input
                      id="adAccountId-input"
                      type="text"
                      name="adAccountId"
                      value={form.adAccountId}
                      onChange={handleFieldChange}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted mt-1">
                      Puedes añadir varios IDs separados por comas o espacios.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="pageId-input" className="text-sm font-medium">
                      ID de la Página{' '}
                      <span className="text-muted-foreground text-xs">(opcional)</span>
                    </label>
                    <Input
                      id="pageId-input"
                      type="text"
                      name="pageId"
                      placeholder="ID de la página"
                      value={form.pageId}
                      onChange={handleFieldChange}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label htmlFor="pixelId-input" className="text-sm font-medium">
                      ID del Píxel de Meta
                    </label>
                    <Input
                      id="pixelId-input"
                      type="text"
                      name="pixelId"
                      placeholder="ID del píxel"
                      value={form.pixelId ?? ''}
                      onChange={handleFieldChange}
                      className="mt-1"
                    />
                  </div>
                </>
              )}

              {form.service === 'whatsapp' && (
                <div>
                  <label htmlFor="phoneNumberId-input" className="text-sm font-medium">
                    ID del Número de Teléfono <span className="text-red-500">*</span>
                  </label>
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

              {form.service === 'google_ads' && (
                <div>
                  <label htmlFor="googleAdsCustomerId-input" className="text-sm font-medium">
                    Customer ID de Google Ads <span className="text-red-500">*</span>
                  </label>
                  <Input
                    id="googleAdsCustomerId-input"
                    type="text"
                    name="googleAdsCustomerId"
                    value={form.googleAdsCustomerId ?? ''}
                    onChange={handleFieldChange}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted mt-1">
                    El ID de cliente de la cuenta de Google Ads que deseas consultar.
                  </p>
                </div>
              )}

              {saveError && <p className="text-sm text-[#D9534F]">{saveError}</p>}

              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={saving} className="flex-1">
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Guardando…
                    </>
                  ) : (
                    'Conectar'
                  )}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card>
          <CardContent className="py-6 text-sm text-muted">Cargando integraciones…</CardContent>
        </Card>
      )}
      {error && (
        <Card className="border-[#D9534F]/30 bg-[#D9534F]/8">
          <CardContent className="py-6 text-sm text-[#D9534F]">{error}</CardContent>
        </Card>
      )}
      {!loading && !error && integrations.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted">
            No hay integraciones conectadas aún. Haz clic en "Agregar integración" para comenzar.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {integrations.map((integration) => {
          const health = resolveIntegrationHealth(integration)
          const degradedReason = health === 'degraded' ? healthDegradedReason(integration) : null
          const icon = serviceIcons[integration.service] ?? '🔗'
          const meta = integration.metadata ?? {}
          const rawAdAccountIds =
            meta.adAccountIds ??
            meta.ad_account_ids ??
            meta.adAccountId ??
            meta.ad_account_id ??
            ''
          const adAccountIds = extractAdAccountIds(rawAdAccountIds)
          const pageId = String(meta.pageId ?? meta.page_id ?? '')
          const pixelId = String(meta.pixelId ?? meta.pixel_id ?? '')
          const customerId = String(meta.customerId ?? meta.customer_id ?? '')
          const lastSync = integration.last_sync ?? String(meta.last_sync ?? '')

          return (
            <Card
              key={integration.id}
              className={
                health === 'degraded' ? 'border-[#E0A020]/40' : ''
              }
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">
                  {icon} {formatServiceName(integration.service)}
                </CardTitle>
                {health === 'ok' && (
                  <Badge className="bg-[#28A745]/10 text-[#28A745] border border-[#28A745]/30">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {healthLabel(health)}
                  </Badge>
                )}
                {health === 'degraded' && (
                  <Badge className="bg-[#E0A020]/10 text-[#E0A020] border border-[#E0A020]/30">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    {healthLabel(health)}
                  </Badge>
                )}
                {health === 'disconnected' && (
                  <Badge className="bg-[#D9534F]/10 text-[#D9534F] border border-[#D9534F]/30">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    {integration.status || 'Inactivo'}
                  </Badge>
                )}
              </CardHeader>

              <CardContent className="space-y-2">
                {/* Degraded reason — actionable, not hidden */}
                {degradedReason && (
                  <div className="rounded-lg border border-[#E0A020]/30 bg-[#E0A020]/8 px-3 py-2 text-xs text-[#5C5550]">
                    {degradedReason}
                  </div>
                )}

                {adAccountIds.length > 0 && (
                  <p className="text-xs text-muted">
                    Cuenta{adAccountIds.length > 1 ? 's' : ''} Publicitaria
                    {adAccountIds.length > 1 ? 's' : ''}:{' '}
                    <span className="font-mono">{adAccountIds.join(', ')}</span>
                  </p>
                )}
                {pageId && (
                  <p className="text-xs text-muted">
                    ID de la Página: <span className="font-mono">{pageId}</span>
                  </p>
                )}
                {pixelId && (
                  <p className="text-xs text-muted">
                    ID del Píxel: <span className="font-mono">{pixelId}</span>
                  </p>
                )}
                {customerId && (
                  <p className="text-xs text-muted">
                    Customer ID: <span className="font-mono">{customerId}</span>
                  </p>
                )}
                {lastSync ? (
                  <p className="text-xs text-muted">
                    Última sincronización: {new Date(lastSync).toLocaleString('es-ES')}
                  </p>
                ) : (
                  <p className="text-xs text-[#E0A020]">Última sincronización: nunca</p>
                )}
                {integration.last_error && (
                  <p className="text-xs text-[#D9534F]">
                    Último error: {integration.last_error}
                  </p>
                )}
                {integration.updated_at && (
                  <p className="text-xs text-muted">
                    Actualizado: {new Date(integration.updated_at).toLocaleString('es-ES')}
                  </p>
                )}
                {testResult[integration.service] && (
                  <p className="text-xs text-foreground bg-card rounded p-2">
                    {testResult[integration.service]}
                  </p>
                )}
                <div className="grid gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={testing === integration.service}
                    onClick={() => void handleTest(integration.service)}
                  >
                    {testing === integration.service ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                        Probando…
                      </>
                    ) : (
                      'Probar Conexión'
                    )}
                  </Button>
                  {integration.service === 'meta' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={healthLoading === integration.service}
                      onClick={() => void handleHealthCheck(integration.service)}
                    >
                      {healthLoading === integration.service ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                          Verificando…
                        </>
                      ) : (
                        'Verificar accesos'
                      )}
                    </Button>
                  )}
                </div>
                {healthResult[integration.service] && (
                  <p className="text-xs text-muted mt-2">{healthResult[integration.service]}</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
