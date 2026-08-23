import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { AlertCircle } from 'lucide-react'
import { invokeApi } from '../lib/invokeApi'
import type { FinancialsState } from '../types'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { SortableTable } from '../components/ui/SortableTable'
import type { ColDef } from '../components/ui/SortableTable'

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function Financials() {
  const [from, setFrom] = useState<string>(() => {
    const d = new Date()
    return toLocalDateInputValue(new Date(d.getFullYear(), d.getMonth(), 1))
  })
  const [to, setTo] = useState<string>(() => toLocalDateInputValue(new Date()))
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
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const qs = params.toString() ? `?${params.toString()}` : ''

      try {
        const data: any = await invokeApi(`/api/financials/summary${qs}`)
        if (cancelled) return
        setState({
          summary: data?.summary ?? null,
          monthly: Array.isArray(data?.monthly) ? data.monthly : [],
          templateMix: Array.isArray(data?.templateMix) ? data.templateMix : [],
          loading: false,
          error: data?.summary ? null : 'Todavía no hay registros operativos de Doctoralia disponibles.',
        })
      } catch (err: any) {
        if (cancelled) return
        setState({
          summary: null,
          monthly: [],
          templateMix: [],
          loading: false,
          error: err?.message || 'No se pudieron cargar los registros operativos de Doctoralia.',
        })
      }
    }

    load()
    return () => { cancelled = true }
  }, [from, to])

  const monthlyRows = state.monthly.map((month) => ({
    month: month.month,
    count: month.count ?? 0,
  }))

  const totalProcedureRecords = state.templateMix.reduce((sum, row) => sum + Number(row.count ?? 0), 0)
  const templateRows = state.templateMix.map((row) => ({
    name: row.name,
    count: row.count,
    pct: totalProcedureRecords > 0 ? Number(((row.count / totalProcedureRecords) * 100).toFixed(1)) : 0,
  }))

  const monthlyColumns: ColDef[] = [
    { key: 'month', label: 'Mes', align: 'left' },
    { key: 'count', label: 'Registros', align: 'right', sortable: true },
  ]

  const templateMixColumns: ColDef[] = [
    { key: 'name', label: 'Procedimiento', align: 'left' },
    { key: 'count', label: 'Registros', align: 'right', sortable: true },
    { key: 'pct', label: 'Participación %', align: 'right', sortable: true, format: (v) => v == null ? null : `${v}%` },
  ]

  const setThisMonth = () => {
    const d = new Date()
    setFrom(toLocalDateInputValue(new Date(d.getFullYear(), d.getMonth(), 1)))
    setTo(toLocalDateInputValue(d))
  }

  const setLastMonth = () => {
    const d = new Date()
    setFrom(toLocalDateInputValue(new Date(d.getFullYear(), d.getMonth() - 1, 1)))
    setTo(toLocalDateInputValue(new Date(d.getFullYear(), d.getMonth(), 0)))
  }

  if (state.loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Auditoría operativa Doctoralia</h1>
          <p className="text-muted mt-1">Registros de citas importados y su cobertura operativa</p>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-card rounded-lg" />
          <div className="h-24 bg-card rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-serif font-bold text-foreground">Auditoría operativa Doctoralia</h1>
          <p className="text-muted mt-1">Volumen, cancelaciones y mix de procedimientos de los registros importados</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-card rounded-lg p-1">
            <button onClick={setThisMonth} className="px-3 py-1 rounded text-xs font-medium text-muted hover:text-foreground transition-colors">Este mes</button>
            <button onClick={setLastMonth} className="px-3 py-1 rounded text-xs font-medium text-muted hover:text-foreground transition-colors">Mes pasado</button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-card border border-border rounded px-2 py-1 text-foreground text-xs focus:outline-none focus:border-muted" />
            <span>→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-card border border-border rounded px-2 py-1 text-foreground text-xs focus:outline-none focus:border-muted" />
          </div>
        </div>
      </div>

      <div className="p-4 bg-[#E0A020]/10 border border-[#E0A020]/30 rounded-lg flex gap-3">
        <AlertCircle className="w-5 h-5 text-[#E0A020] flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Sin fuente de cobros conciliada</p>
          <p className="text-sm text-foreground">
            Los importes presentes en la exportación de citas de Doctoralia no se consideran ingresos, caja ni liquidaciones verificadas. Esta vista muestra únicamente hechos operativos hasta integrar una fuente contable o de pagos reconciliada.
          </p>
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
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Registros importados</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{state.summary?.operationsCount ?? 0}</div><p className="text-xs text-muted mt-1">Filas del período seleccionado</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Sin cancelación registrada</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{state.summary?.settledCount ?? 0}</div><p className="text-xs text-muted mt-1">Estado operativo, no estado de cobro</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Cancelados</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{state.summary?.cancelledCount ?? 0}</div><p className="text-xs text-muted mt-1">Registros con cancelación</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Procedimientos</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{state.templateMix.length}</div><p className="text-xs text-muted mt-1">Categorías presentes en el período</p></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Volumen mensual de registros</CardTitle></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyRows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" name="Registros" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Mix operativo por procedimiento</CardTitle></CardHeader>
          <CardContent><SortableTable columns={templateMixColumns} rows={templateRows} /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Detalle mensual de volumen</CardTitle></CardHeader>
        <CardContent><SortableTable columns={monthlyColumns} rows={monthlyRows} /></CardContent>
      </Card>
    </div>
  )
}
