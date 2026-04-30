import { useEffect, useState } from 'react'
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
import { invokeApi } from '../lib/supabaseClient'

interface DashboardMetrics {
  totalLeads: number
  conversionRate: number
  activeCampaigns: number
  spend: number
  averageCpc: number
  loading: boolean
  error: string | null
}

interface MetaTrendPoint {
  week: string
  value: number
}

const defaultTrend: MetaTrendPoint[] = [
  { week: 'W1', value: 12 },
  { week: 'W2', value: 16 },
  { week: 'W3', value: 22 },
  { week: 'W4', value: 18 },
  { week: 'W5', value: 24 },
]

// Fallback mock trend para cuando la API de Meta no está disponible localmente.
// Estos valores se usan solo mientras se validan las llamadas reales a la API.

export default function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalLeads: 0,
    conversionRate: 0,
    activeCampaigns: 0,
    spend: 0,
    averageCpc: 0,
    loading: true,
    error: null,
  })
  const [trendData, setTrendData] = useState<MetaTrendPoint[]>(defaultTrend)

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const [metricsResponse, metaTrendsResponse, campaignsResponse] = await Promise.all([
          invokeApi('/dashboard/metrics'),
          invokeApi('/dashboard/meta-trends'),
          invokeApi('/meta/campaigns'),
        ])

        const metrics = metricsResponse?.metrics ?? {}
        const campaigns = Array.isArray(campaignsResponse?.campaigns) ? campaignsResponse.campaigns : []
        const avgCpc = Number(
          campaigns.reduce((sum: number, campaign: any) => sum + Number(campaign.insights?.cpc ?? 0), 0) /
            Math.max(campaigns.filter((campaign: any) => Number(campaign.insights?.cpc ?? 0) > 0).length, 1),
        )
        const spend = Number(
          campaigns.reduce((sum: number, campaign: any) => sum + Number(campaign.insights?.spend ?? 0), 0),
        )

        setTrendData(
          Array.isArray(metaTrendsResponse?.trends) && metaTrendsResponse.trends.length
            ? metaTrendsResponse.trends.map((item: any) => ({
                week: item.date_start ?? item.date ?? '–',
                value: Number(item.spend ?? 0),
              }))
            : defaultTrend,
        )

        setMetrics({
          totalLeads: Number(metrics.totalLeads ?? 0),
          conversionRate: Number(metrics.conversionRate ?? 0),
          activeCampaigns: campaigns.length,
          spend,
          averageCpc: Number.isFinite(avgCpc) ? Number.parseFloat(avgCpc.toFixed(2)) : 0,
          loading: false,
          error: null,
        })
      } catch (err: any) {
        console.error('Meta dashboard fetch failed:', err)
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: err?.message || 'Unable to load Meta metrics',
        }))
      }
    }

    fetchMetrics()
  }, [])

  if (metrics.loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-slate-600 mt-1">Loading metrics...</p>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-slate-200 rounded-lg" />
          <div className="h-24 bg-slate-200 rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-slate-600 mt-1">Control centre — Meta KPIs, agent status, adaptive plan</p>
      </div>

      {metrics.error && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-900">Connection Issue</p>
            <p className="text-sm text-yellow-800 mt-1">
              {metrics.error}. Using demo data. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your environment.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversions</CardTitle>
            <Users className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalLeads.toLocaleString()}</div>
            <p className="text-xs text-slate-500 mt-1">Meta conversions in the last 30 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.conversionRate}%</div>
            <p className="text-xs text-slate-500 mt-1">Calculated from Meta clicks and conversions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
            <Zap className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.activeCampaigns}</div>
            <p className="text-xs text-slate-500 mt-1">Meta campaigns currently synced</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Meta Spend (últimos 7 días)</CardTitle>
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

        <Card>
          <CardHeader>
            <CardTitle>Meta Campaign KPIs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">Spend</span>
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="mt-3 text-2xl font-semibold">${metrics.spend.toLocaleString()}</p>
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
                <p className="mt-3 text-2xl font-semibold">{metrics.totalLeads.toLocaleString()}</p>
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
          <p className="text-slate-600 text-sm">Connecting to Supabase Realtime...</p>
        </CardContent>
      </Card>
    </div>
  )
}
