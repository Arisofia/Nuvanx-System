import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { AlertCircle } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'
import type { MonthlyTrend, FinancialsState } from '../types'
import { SortableTable } from '../components/ui/SortableTable'
import type { ColDef } from '../components/ui/SortableTable'

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
    templateMix: [],
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
          templateMix: Array.isArray(data?.templateMix) ? data.templateMix : [],
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
    n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

  const monthlyColumns: ColDef[] = [
    { key: 'month', label: 'Month', align: 'left' },
    { key: 'gross', label: 'Gross', align: 'right', format: (v) => v == null ? null : fmt(Number(v)) },
    { key: 'net', label: 'Net', align: 'right', format: (v) => v == null ? null : fmt(Number(v)) },
    { key: 'discount', label: 'Discount', align: 'right', format: (v) => v == null ? null : fmt(Number(v)) },
    { key: 'count', label: 'Ops', align: 'right' },
    { key: 'avgTicket', label: 'Avg Ticket', align: 'right', format: (v) => v == null ? null : fmt(Number(v)) },
  ]

  const monthlyRows = state.monthly.map((m: MonthlyTrend) => ({
    month: m.month,
    gross: m.gross ?? null,
    net: m.net,
    discount: m.discount ?? null,
    count: m.count ?? null,
    avgTicket: m.count && m.count > 0 ? Math.round(m.net / m.count) : null,
  }))

  if (state.loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Verified Financials</h1>
          <p className="text-muted mt-1">Doctoralia settlements, LTV, verified revenue</p>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-card rounded-lg" />
          <div className="h-24 bg-card rounded-lg" />
        </div>
      </div>
    )
  }

  const templateMixColumns: ColDef[] = [
    { key: 'name', label: 'Template', align: 'left' },
    { key: 'count', label: 'Ops', align: 'right' },
    { key: 'net', label: 'Net Revenue', align: 'right', format: (v) => v == null ? null : fmt(Number(v)) },
    { key: 'pct', label: 'Share %', align: 'right', format: (v) => v == null ? null : `${v}%` },
  ]

  const liquidationLabel =
    state.summary && state.summary.avgLiquidationDays > 0
      ? `${state.summary.avgLiquidationDays}d`
      : '—'

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-serif font-bold text-foreground">Finanzas verificadas</h1>
          <p className="text-muted mt-1">Liquidaciones de Doctoralia, LTV, ingresos verificados</p>
        </div>
        {/* Period presets */}
        <div className="flex items-center gap-1 bg-card rounded-lg p-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { setPresetDays(p.days); setFromDate(''); setToDate('') }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                presetDays === p.days && !fromDate && !toDate
                  ? 'bg-primary/15 text-foreground'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {p.label === 'Todo' ? 'Todo' : p.label}
            </button>
          ))}
        </div>
        {/* Custom date range */}
        <div className="flex items-center gap-2 text-xs text-muted">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPresetDays(-1) }}
            className="bg-card border border-border rounded px-2 py-1 text-foreground text-xs focus:outline-none focus:border-muted"
          />
          <span>→</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPresetDays(-1) }}
            className="bg-card border border-border rounded px-2 py-1 text-foreground text-xs focus:outline-none focus:border-muted"
          />
        </div>
      </div>

      {state.error && (
        <div className="p-4 bg-[#E0A020]/10 border border-[#E0A020]/30 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-[#E0A020] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-foreground">{state.error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Ingresos verificados (Neto)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{state.summary ? fmt(state.summary.totalNet) : '—'}</div>
            <p className="text-xs text-muted mt-1">
              {state.summary
                ? `${state.summary.settledCount} liquidados · ${state.summary.cancelledCount} cancelados`
                : 'De liquidaciones de Doctoralia'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Ingresos brutos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{state.summary ? fmt(state.summary.totalGross) : '—'}</div>
            <p className="text-xs text-muted mt-1">Antes de descuentos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Operaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{state.summary ? state.summary.operationsCount : '—'}</div>
            <p className="text-xs text-muted mt-1">Cantidad total de liquidaciones</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Ticket promedio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{state.summary ? fmt(state.summary.avgTicket) : '—'}</div>
            <p className="text-xs text-muted mt-1">Por transacción liquidada</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Tasa de descuento</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{state.summary ? `${state.summary.discountRate}%` : '—'}</div>
            <p className="text-xs text-muted mt-1">Descuento aplicado sobre ingresos brutos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Tasa de cancelación</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{state.summary ? `${state.summary.cancellationRate}%` : '—'}</div>
            <p className="text-xs text-muted mt-1">Porcentaje de liquidaciones canceladas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Promedio de liquidación</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{liquidationLabel}</div>
            <p className="text-xs text-muted mt-1">
              {state.summary?.avgLiquidationDays === 0 ? 'Sin fecha de entrada' : 'Días desde entrada hasta liquidación'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tendencia de ingresos mensuales</CardTitle>
        </CardHeader>
        <CardContent>
          {state.monthly.length === 0 ? (
            <p className="text-muted text-sm py-8 text-center">No hay datos de liquidación disponibles todavía.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={state.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6E2DE" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#7A7573', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#7A7573', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E2DE', fontSize: 12 }}
                  formatter={(v: number) => fmt(v)}
                />
                <Legend />
                <Line type="monotone" dataKey="net" name="Ingreso Neto" stroke="#C49A6C" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {monthlyRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Monthly Revenue — Full Table</CardTitle>
          </CardHeader>
          <CardContent>
            <SortableTable
              columns={monthlyColumns}
              rows={monthlyRows}
              exportFilename="financials-monthly"
              pageSize={60}
              emptyMessage="No monthly data available."
            />
          </CardContent>
        </Card>
      )}

      {state.templateMix.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Template</CardTitle>
          </CardHeader>
          <CardContent>
            <SortableTable
              columns={templateMixColumns}
              rows={state.templateMix}
              exportFilename="financials-template-mix"
              pageSize={200}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
