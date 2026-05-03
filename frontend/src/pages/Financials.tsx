import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { AlertCircle } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'

interface FinancialSummary {
  totalNet: number
  totalGross: number
  totalDiscount: number
  avgTicket: number
  discountRate: number
  avgLiquidationDays: number
  settledCount: number
  cancelledCount: number
}

interface MonthlyTrend {
  month: string
  net: number
}

interface FinancialsState {
  summary: FinancialSummary | null
  monthly: MonthlyTrend[]
  loading: boolean
  error: string | null
}

const PRESETS = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: 'Todo', days: 0 },
] as const

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10)
}

export default function Financials() {
  const [presetDays, setPresetDays] = useState<number>(0) // 0 = all time
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [state, setState] = useState<FinancialsState>({
    summary: null,
    monthly: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      let from = fromDate
      let to = toDate
      if (presetDays > 0 && !fromDate && !toDate) {
        from = toISODate(new Date(Date.now() - presetDays * 86_400_000))
        to = toISODate(new Date())
      }

      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const qs = params.toString() ? `?${params.toString()}` : ''

      try {
        const data: any = await invokeApi(`/financials/summary${qs}`)
        if (cancelled) return
        setState({
          summary: data?.summary ?? null,
          monthly: Array.isArray(data?.monthly) ? data.monthly : [],
          loading: false,
          error: data?.summary ? null : 'No financial data available yet.',
        })
      } catch (err: any) {
        if (cancelled) return
        setState({ summary: null, monthly: [], loading: false, error: err?.message || 'Failed to load financials.' })
      }
    }

    load()
    return () => { cancelled = true }
  }, [presetDays, fromDate, toDate])

  const fmt = (n: number) =>
    n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })

  if (state.loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Verified Financials</h1>
          <p className="text-slate-600 mt-1">Doctoralia settlements, LTV, verified revenue</p>
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
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-bold">Verified Financials</h1>
          <p className="text-slate-600 mt-1">Doctoralia settlements, LTV, verified revenue</p>
        </div>
        {/* Period presets */}
        <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { setPresetDays(p.days); setFromDate(''); setToDate('') }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                presetDays === p.days && !fromDate && !toDate
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {/* Custom date range */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPresetDays(-1) }}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-slate-500"
          />
          <span>→</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPresetDays(-1) }}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-slate-500"
          />
        </div>
      </div>

      {state.error && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-800">{state.error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Verified Revenue (Net)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{state.summary ? fmt(state.summary.totalNet) : '—'}</div>
            <p className="text-xs text-slate-500 mt-1">
              {state.summary ? `${state.summary.settledCount} settled transactions` : 'From Doctoralia settlements'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Average Ticket</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{state.summary ? fmt(state.summary.avgTicket) : '—'}</div>
            <p className="text-xs text-slate-500 mt-1">Per settled transaction</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Discount Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{state.summary ? `${state.summary.discountRate}%` : '—'}</div>
            <p className="text-xs text-slate-500 mt-1">Discount applied on gross revenue</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly Revenue Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {state.monthly.length === 0 ? (
            <p className="text-slate-500 text-sm py-8 text-center">No settlement data available yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={state.monthly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend />
                <Line type="monotone" dataKey="net" name="Net Revenue" stroke="#3b82f6" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
