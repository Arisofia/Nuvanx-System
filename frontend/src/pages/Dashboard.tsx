import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { TrendingUp, Users, Zap, AlertCircle, DollarSign, ArrowUpRight, Percent } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { invokeApi, supabase, supabaseKey, supabaseUrl } from '../lib/supabaseClient'
import type { DashboardMetrics, MetaTrendPoint, ActivityEvent } from '../types'

import { MetricDelta } from '../components/dashboard/MetricDelta'
import { FunnelChart } from '../components/dashboard/FunnelChart'
import { AgentStatusCard } from '../components/dashboard/AgentStatusCard'

export default function Dashboard() {
  const [days, setDays] = useState<7 | 14 | 30 | 90>(30)
  const [campaignId, setCampaignId] = useState<string>('ALL')
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')
  const [sourcesList, setSourcesList] = useState<string[]>([])
  const [campaignsList, setCampaignsList] = useState<{ id: string, name: string }[]>([])
  const [funnelData, setFunnelData] = useState<any[]>([])
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalLeads: 0,
    conversionRate: 0,
    activeCampaigns: 0,
    spend: 0,
    averageCpc: 0,
    metaConversions: 0,
    loading: true,
    error: null,
    metaError: null,
  })
  const [trendData, setTrendData] = useState<MetaTrendPoint[]>([])
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-lead-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        const r = payload.new as any
        setActivity((prev) => [{
          id: String(r.id ?? Math.random()),
          label: 'New lead received',
          detail: r.source ? `From ${r.source}` : 'New entry in pipeline',
          ts: r.created_at ?? new Date().toISOString(),
        }, ...prev].slice(0, 20))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (payload) => {
        const r = payload.new as any
        setActivity((prev) => [{
          id: String(r.id ?? Math.random()) + '-upd',
          label: 'Lead updated',
          detail: r.stage ? `Stage: ${r.stage}` : 'Record updated',
          ts: r.updated_at ?? new Date().toISOString(),
        }, ...prev].slice(0, 20))
      })
      .subscribe()
    channelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    const fetchMetrics = async () => {
      if (!supabaseUrl || !supabaseKey) {
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: 'Supabase environment variables are not configured.',
        }))
        return
      }

      // Guard: bail out if there is no active user session. The route guard in
      // App.tsx will redirect to /login — no need to show an error here.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setMetrics((prev) => ({ ...prev, loading: false }))
        return
      }

      try {
        const queryParams = `?days=${days}${campaignId !== 'ALL' ? `&campaign_id=${campaignId}` : ''}`
        const dashboardParams = `${queryParams}${sourceFilter !== 'ALL' ? `&source=${sourceFilter}` : ''}`
        const [metricsResult, metaTrendsResult, campaignsResult, insightsResult, funnelResult] = await Promise.allSettled([
          invokeApi(`/dashboard/metrics${dashboardParams}`),
          invokeApi(`/dashboard/meta-trends${queryParams}`),
          invokeApi(`/meta/campaigns?days=${days}`),
          invokeApi(`/meta/insights${queryParams}`),
          invokeApi('/dashboard/lead-flow'),
        ])

        // Lead/DB metrics — fatal if this fails
        if (metricsResult.status === 'rejected') {
          throw metricsResult.reason
        }
        const metricsData = metricsResult.value?.metrics ?? {}
        if (metricsData.bySource && Object.keys(metricsData.bySource).length > 0 && sourcesList.length === 0) {
          setSourcesList(Object.keys(metricsData.bySource))
        }

        if (funnelResult.status === 'fulfilled') {
          setFunnelData(funnelResult.value.funnel || [])
        }

        // Meta API calls — non-fatal, show specific warning
        const campaignsResponse = campaignsResult.status === 'fulfilled' ? campaignsResult.value : null
        const metaTrendsResponse = metaTrendsResult.status === 'fulfilled' ? metaTrendsResult.value : null
        const insightsResponse = insightsResult.status === 'fulfilled' ? insightsResult.value : null

        const metaFailureMessage = (campaignsResult.status === 'rejected' || insightsResult.status === 'rejected')
          ? ((campaignsResult as any).reason?.message || (insightsResult as any).reason?.message || 'Meta API unavailable')
          : null

        const campaigns = Array.isArray(campaignsResponse?.campaigns) ? campaignsResponse.campaigns : []
        if (campaigns.length > 0 && campaignsList.length === 0) {
          setCampaignsList(campaigns.map((c: any) => ({ id: c.id, name: c.name })))
        }

        // Use account-level summary from /meta/insights for accurate totals;
        // fall back to summing per-campaign if insights endpoint failed.
        const insightsSummary = insightsResponse?.summary
        const spend = insightsSummary?.spend != null
          ? Number(insightsSummary.spend)
          : Number(campaigns.reduce((sum: number, c: any) => sum + Number(c.insights?.spend ?? 0), 0))
        const avgCpcRaw = insightsSummary?.cpc != null
          ? Number(insightsSummary.cpc)
          : Number(
              campaigns.reduce((sum: number, c: any) => sum + Number(c.insights?.cpc ?? 0), 0) /
                Math.max(campaigns.filter((c: any) => Number(c.insights?.cpc ?? 0) > 0).length, 1),
            )
        const metaConversions = insightsSummary?.conversions != null
          ? Number(insightsSummary.conversions)
          : campaigns.reduce((sum: number, c: any) => sum + Number(c.insights?.conversions ?? 0), 0)

        const spendDelta = insightsResponse?.changes?.spend ?? 0

        setTrendData(
          Array.isArray(metaTrendsResponse?.trends)
            ? metaTrendsResponse.trends.map((item: any) => ({
                week: item.date_start ?? item.date ?? '–',
                value: Number(item.spend ?? 0),
              }))
            : [],
        )

        setMetrics({
          totalLeads: Number(metricsData.totalLeads ?? 0),
          conversionRate: Number(metricsData.conversionRate ?? 0),
          verifiedRevenue: Number(metricsData.verifiedRevenue ?? 0),
          totalRevenue: Number(metricsData.totalRevenue ?? 0),
          settledCount: Number(metricsData.settledCount ?? 0),
          activeCampaigns: campaigns.filter((c: any) => c.status === 'ACTIVE').length,
          spend,
          averageCpc: Number.isFinite(avgCpcRaw) ? Number.parseFloat(avgCpcRaw.toFixed(2)) : 0,
          metaConversions,
          deltas: {
            leads: metricsData.deltas?.leads ?? 0,
            revenue: metricsData.deltas?.revenue ?? 0,
            conversions: metricsData.deltas?.conversions ?? 0,
            spend: Number(spendDelta),
          },
          loading: false,
          error: null,
          metaError: metaFailureMessage,
        })
      } catch (err: any) {
        console.error('Dashboard fetch failed:', err)
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: err?.message || 'Unable to load dashboard metrics',
          metaError: null,
        }))
      }
    }

    fetchMetrics()
  }, [days, campaignId, sourceFilter, campaignsList.length, sourcesList.length])

  if (metrics.loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-slate-400 mt-1">Loading metrics...</p>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-slate-800 rounded-lg" />
          <div className="h-24 bg-slate-800 rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-slate-400 mt-1">Control centre — Meta KPIs, agent status, adaptive plan</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2">
          {sourcesList.length > 0 && (
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded-lg border-none focus:ring-1 focus:ring-slate-500"
            >
              <option value="ALL">All Sources</option>
              {sourcesList.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {campaignsList.length > 0 && (
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded-lg border-none focus:ring-1 focus:ring-slate-500"
            >
              <option value="ALL">All Campaigns</option>
              {campaignsList.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
            {([7, 14, 30, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  days === d ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {metrics.error && (
        <div className="p-4 bg-red-950/40 border border-red-800 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-300">Connection Error</p>
            <p className="text-sm text-red-300 mt-1">{metrics.error}</p>
          </div>
        </div>
      )}

      {metrics.metaError && !metrics.error && (
        <div className="p-4 bg-amber-950/40 border border-amber-800 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-300">Meta Ads not connected</p>
            <p className="text-sm text-amber-300 mt-1">
              {metrics.metaError.includes('#200') || metrics.metaError.includes('permission')
                ? 'Your Meta token is missing ads_management or ads_read permissions. Reconnect your Meta account in Integrations to fix this.'
                : metrics.metaError}
            </p>
            <a
              href="/integrations"
              className="inline-block mt-2 text-sm font-medium text-amber-400 underline hover:text-amber-200"
            >
              Go to Integrations →
            </a>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversions</CardTitle>
            <Users className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold">{metrics.metaConversions.toLocaleString()}</div>
              {metrics.deltas && <MetricDelta value={metrics.deltas.conversions} />}
            </div>
            <p className="text-xs text-slate-500 mt-1">Conversiones Meta · últimos {days} días</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
            <Users className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold">{metrics.totalLeads.toLocaleString()}</div>
              {metrics.deltas && <MetricDelta value={metrics.deltas.leads} />}
            </div>
            <p className="text-xs text-slate-500 mt-1">Leads en BD · últimos {days} días</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.conversionRate}%</div>
            <p className="text-xs text-slate-500 mt-1">Calculado desde leads en BD</p>
          </CardContent>
        </Card>

        <AgentStatusCard />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Lead Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelChart data={funnelData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Meta Spend (últimos {days} días)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} />
                <Area type="monotone" dataKey="value" stroke="#38bdf8" fill="url(#trendGradient)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Meta Campaign KPIs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">Spend</span>
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="flex items-baseline gap-2 mt-3">
                  <p className="text-2xl font-semibold">${metrics.spend.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  {metrics.deltas && <MetricDelta value={metrics.deltas.spend} inverse />}
                </div>
              </div>
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">Revenue (Settled)</span>
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="flex items-baseline gap-2 mt-3">
                  <p className="text-2xl font-semibold">${(metrics.verifiedRevenue ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  {metrics.deltas && <MetricDelta value={metrics.deltas.revenue} />}
                </div>
                <p className="text-xs text-slate-500 mt-1">{metrics.settledCount ?? 0} settled · Doctoralia</p>
              </div>
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">Pipeline (Est.)</span>
                  <DollarSign className="h-4 w-4 text-violet-400" />
                </div>
                <div className="flex items-baseline gap-2 mt-3">
                  <p className="text-2xl font-semibold">${(metrics.totalRevenue ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <p className="text-xs text-slate-500 mt-1">{metrics.totalRevenue === 0 ? 'No pipeline revenue yet' : 'Sum of leads.revenue'}</p>
              </div>
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">Avg. CPC</span>
                  <ArrowUpRight className="h-4 w-4 text-sky-400" />
                </div>
                <p className="mt-3 text-2xl font-semibold">${metrics.averageCpc.toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">Conversions</span>
                  <Percent className="h-4 w-4 text-amber-400" />
                </div>
                <p className="mt-3 text-2xl font-semibold">{metrics.metaConversions.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="text-slate-500 text-sm">Waiting for new lead events via Supabase Realtime…</p>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {activity.map((ev) => (
                <div className="p-3 bg-slate-900 rounded-lg border border-slate-700">
                  <p className="text-sm font-medium">{ev.label}</p>
                  <p className="text-xs text-slate-500 mt-1">{ev.detail} • {new Date(ev.ts).toLocaleTimeString()}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
