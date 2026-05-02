import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { invokeApi } from '../lib/supabaseClient'

interface Lead {
  id: string
  name: string
  status: string
  source: string
}

export default function CRM() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadLeads = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await invokeApi('/leads')
        const data = (response as any).leads

        if (Array.isArray(data) && data.length > 0) {
          setLeads(
            data.map((item: any) => ({
              id: String(item.id ?? item.lead_id ?? ''),
              name: item.name ?? item.full_name ?? item.contact_name ?? 'Unknown',
              status: item.stage ?? item.status ?? 'Unknown',
              source: item.source ?? 'Edge',
            })),
          )
        } else {
          throw new Error('No leads returned from API')
        }
      } catch (err: any) {
        console.warn('CRM API call failed:', err)
        setError(err?.message || 'Unable to load leads from API.')
        setLeads([])
      } finally {
        setLoading(false)
      }
    }

    loadLeads()
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">CRM</h1>
        <p className="text-slate-600 mt-1">Lead pipeline — stages, DNI, lost_reason</p>
      </div>

      <Tabs defaultValue="pipeline" className="w-full">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="stages">Stages</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {['New', 'Contacted', 'Qualified', 'Closed'].map((stage) => (
              <Card key={stage}>
                <CardHeader>
                  <CardTitle className="text-base">{stage}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">0</p>
                  <p className="text-xs text-slate-500 mt-1">Leads in stage</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leads">
          <Card>
            <CardHeader>
              <CardTitle>All Leads</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-slate-600">Fetching leads from Edge Function...</p>
              ) : (
                <div className="space-y-3">
                  {error && <p className="text-sm text-yellow-500">{error}</p>}
                  <div className="grid gap-3">
                    {leads.map((lead) => (
                      <div key={lead.id} className="rounded-xl border border-border p-4 bg-slate-950">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-white">{lead.name}</p>
                          <span className="text-xs uppercase text-slate-500">{lead.status}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">Source: {lead.source}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stages">
          <Card>
            <CardHeader>
              <CardTitle>Stage Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600">Manage lead pipeline stages and transitions.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
