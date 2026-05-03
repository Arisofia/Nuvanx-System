import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { invokeApi } from '../lib/supabaseClient'
import type { FunnelRow, CampaignPerformance as Campaign, Conversation } from '../types'

export default function Intelligence() {
  const [funnel, setFunnel] = useState<FunnelRow[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState({ funnel: true, campaigns: true, conversations: true })
  const [error, setError] = useState<{ funnel?: string; campaigns?: string; conversations?: string }>({})

  useEffect(() => {
    invokeApi('/traceability/funnel')
      .then((data: any) => {
        setFunnel(Array.isArray(data?.funnel) ? data.funnel : [])
        setLoading((prev) => ({ ...prev, funnel: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, funnel: err?.message || 'Failed to load funnel.' }))
        setLoading((prev) => ({ ...prev, funnel: false }))
      })

    invokeApi('/traceability/campaigns')
      .then((data: any) => {
        setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : [])
        setLoading((prev) => ({ ...prev, campaigns: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, campaigns: err?.message || 'Failed to load campaigns.' }))
        setLoading((prev) => ({ ...prev, campaigns: false }))
      })

    invokeApi('/conversations')
      .then((data: any) => {
        setConversations(Array.isArray(data?.conversations) ? data.conversations.slice(0, 20) : [])
        setLoading((prev) => ({ ...prev, conversations: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, conversations: err?.message || 'Failed to load conversations.' }))
        setLoading((prev) => ({ ...prev, conversations: false }))
      })
  }, [])

  const totalLeads = campaigns.reduce((sum, c) => sum + Number(c.total_leads ?? 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Intelligence</h1>
        <p className="text-slate-600 mt-1">Campaign attribution, WhatsApp funnel, conversation log</p>
      </div>

      <Tabs defaultValue="attribution" className="w-full">
        <TabsList>
          <TabsTrigger value="attribution">Attribution</TabsTrigger>
          <TabsTrigger value="funnel">WhatsApp Funnel</TabsTrigger>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
        </TabsList>

        <TabsContent value="attribution">
          <Card>
            <CardHeader>
              <CardTitle>Multi-Touch Attribution</CardTitle>
            </CardHeader>
            <CardContent>
              {loading.campaigns ? (
                <p className="text-slate-500 text-sm">Loading attribution data…</p>
              ) : error.campaigns ? (
                <p className="text-sm text-red-500">{error.campaigns}</p>
              ) : campaigns.length === 0 ? (
                <p className="text-slate-500 text-sm">No attribution data available yet.</p>
              ) : (
                <div className="space-y-3">
                  {campaigns.map((c, i) => {
                    const pct = totalLeads > 0 ? Math.round((Number(c.total_leads) / totalLeads) * 100) : 0
                    return (
                      <div key={i} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <p className="text-sm font-medium">{c.source}{c.campaign_name ? ` — ${c.campaign_name}` : ''}</p>
                        <p className="text-xs text-slate-500 mt-1">{c.total_leads} leads ({pct}% of total)</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnel">
          <Card>
            <CardHeader>
              <CardTitle>WhatsApp Conversion Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              {loading.funnel ? (
                <p className="text-slate-500 text-sm">Loading funnel data…</p>
              ) : error.funnel ? (
                <p className="text-sm text-red-500">{error.funnel}</p>
              ) : funnel.length === 0 ? (
                <p className="text-slate-500 text-sm">No funnel data available yet.</p>
              ) : (
                <div className="space-y-2">
                  {funnel.map((row, i) => (
                    <div key={i} className={`flex justify-between items-center p-2 rounded bg-blue-${Math.min(50 + i * 50, 300)}`}>
                      <span className="capitalize">{String(row.stage).replace(/_/g, ' ')}</span>
                      <span className="font-bold">
                        {row.count.toLocaleString()}
                        {row.pct != null ? ` (${row.pct}%)` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversations">
          <Card>
            <CardHeader>
              <CardTitle>Recent Conversations</CardTitle>
            </CardHeader>
            <CardContent>
              {loading.conversations ? (
                <p className="text-slate-500 text-sm">Loading conversations…</p>
              ) : error.conversations ? (
                <p className="text-sm text-red-500">{error.conversations}</p>
              ) : conversations.length === 0 ? (
                <p className="text-slate-500 text-sm">No conversations found.</p>
              ) : (
                <div className="space-y-3">
                  {conversations.map((conv) => (
                    <div key={conv.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="flex justify-between">
                        <p className="text-sm font-medium">{conv.phone ?? conv.id}</p>
                        <span className="text-xs text-slate-500 capitalize">{conv.direction}</span>
                      </div>
                      {conv.message_preview && (
                        <p className="text-xs text-slate-600 mt-1 truncate">{conv.message_preview}</p>
                      )}
                      {conv.sent_at && (
                        <p className="text-xs text-slate-400 mt-1">{new Date(conv.sent_at).toLocaleString()}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
