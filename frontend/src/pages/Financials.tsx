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

export default function Financials() {
  const [state, setState] = useState<FinancialsState>({
    summary: null,
    monthly: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    invokeApi('/financials/summary')
      .then((data: any) => {
        setState({
          summary: data?.summary ?? null,
          monthly: Array.isArray(data?.monthly) ? data.monthly : [],
          loading: false,
          error: data?.summary ? null : 'No financial data available yet.',
        })
      })
      .catch((err: any) => {
        setState({ summary: null, monthly: [], loading: false, error: err?.message || 'Failed to load financials.' })
      })
  }, [])

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
      <div>
        <h1 className="text-3xl font-bold">Verified Financials</h1>
        <p className="text-slate-600 mt-1">Doctoralia settlements, LTV, verified revenue</p>
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
