import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { CheckCircle2, AlertCircle, Plus } from 'lucide-react'
import { supabase, supabaseKey, supabaseUrl } from '../lib/supabaseClient'

type IntegrationRow = {
  id: string
  service: string
  status: string | null
  last_error: string | null
  metadata: Record<string, unknown> | null
  created_at: string | null
  updated_at: string | null
  [key: string]: unknown
}

const serviceIcons: Record<string, string> = {
  meta: '📱',
  whatsapp: '💬',
  google_ads: '🔍',
  openai: '🤖',
  gemini: '✨',
  github: '🐙',
  doctoralia: '🏥',
}

function formatServiceName(service: string) {
  return service
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function Integrations() {
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadIntegrations() {
      setLoading(true)
      setError(null)

      if (!supabaseUrl || !supabaseKey) {
        setError('Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.')
        setLoading(false)
        return
      }

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

    loadIntegrations()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Integrations</h1>
          <p className="text-slate-600 mt-1">Credential vault — Meta, WhatsApp, OpenAI, Gemini, GitHub, Google Ads</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Add Integration
        </Button>
      </div>

      {loading && (
        <Card>
          <CardContent className="py-6 text-sm text-slate-600">
            Loading real integrations from Supabase...
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-6 text-sm text-red-700">
            {error}
          </CardContent>
        </Card>
      )}

      {!loading && !error && integrations.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-slate-600">
            No integrations found in Supabase.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {integrations.map((integration) => {
          const isActive = integration.status === 'active'
          const icon = serviceIcons[integration.service] ?? '🔗'

          return (
            <Card key={integration.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">
                  {icon} {formatServiceName(integration.service)}
                </CardTitle>

                {isActive ? (
                  <Badge className="bg-green-50 text-green-700 border-green-200">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Active
                  </Badge>
                ) : (
                  <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    {integration.status || 'Inactive'}
                  </Badge>
                )}
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="text-sm text-slate-600">
                  {integration.last_error
                    ? `Last error: ${integration.last_error}`
                    : 'Connected data loaded from Supabase'}
                </div>

                <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 overflow-auto">
                  <div><strong>ID:</strong> {integration.id}</div>
                  <div><strong>Service:</strong> {integration.service}</div>
                  <div><strong>Status:</strong> {integration.status ?? 'not set'}</div>
                  <div><strong>Updated:</strong> {integration.updated_at ?? 'not set'}</div>
                  <div><strong>Metadata:</strong> {JSON.stringify(integration.metadata ?? {})}</div>
                  <div><strong>Raw row:</strong> {JSON.stringify(integration)}</div>
                </div>

                <Button variant="outline" size="sm" className="w-full">
                  Configure
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
