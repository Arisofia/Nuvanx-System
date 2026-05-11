import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, RefreshCcw } from 'lucide-react'
import { invokeApi } from '../../lib/supabaseClient'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { SortableTable, type ColDef } from '../ui/SortableTable'

type FunnelFilters = {
  lead_from: string
  lead_to: string
  valoracion_from: string
  valoracion_to: string
  posterior_from: string
  posterior_to: string
}

export interface TrazabilidadFunnelRow {
  lead_id: string
  lead_created_at: string | null
  lead_name: string | null
  cita_valoracion: string | null
  cita_posterior: string | null
  fuente: string | null
  estado: string | null
  revenue: number
  conversion_date: string | null
}

interface TrazabilidadFunnelResponse {
  success: boolean
  funnel: TrazabilidadFunnelRow[]
  total: number
}

const EMPTY_FILTERS: FunnelFilters = {
  lead_from: '',
  lead_to: '',
  valoracion_from: '',
  valoracion_to: '',
  posterior_from: '',
  posterior_to: '',
}

function formatDate(value: unknown) {
  if (!value) return '—'
  return new Date(String(value)).toLocaleDateString('es-ES')
}

function buildQuery(filters: FunnelFilters) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })
  const query = params.toString()
  return query ? `?${query}` : ''
}

export default function TrazabilidadFunnelTableFinal() {
  const [filters, setFilters] = useState<FunnelFilters>(EMPTY_FILTERS)
  const [rows, setRows] = useState<TrazabilidadFunnelRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRows = useCallback(async (activeFilters: FunnelFilters) => {
    setLoading(true)
    setError(null)
    try {
      const response = await invokeApi(`/traceability/funnel${buildQuery(activeFilters)}`) as TrazabilidadFunnelResponse
      setRows(response.funnel ?? [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el funnel de trazabilidad.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRows(EMPTY_FILTERS)
  }, [loadRows])

  const summary = useMemo(() => {
    const leads = rows.length
    const valoraciones = rows.filter((row) => row.cita_valoracion).length
    const posteriores = rows.filter((row) => row.cita_posterior).length
    const revenue = rows.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0)
    return { leads, valoraciones, posteriores, revenue }
  }, [rows])

  const columns: ColDef[] = [
    { key: 'lead_name', label: 'Lead', sortable: true },
    { key: 'lead_created_at', label: 'Fecha lead', sortable: true, format: formatDate },
    { key: 'cita_valoracion', label: 'Cita valoración', sortable: true, format: formatDate },
    { key: 'cita_posterior', label: 'Cita posterior', sortable: true, format: formatDate },
    { key: 'fuente', label: 'Fuente' },
    { key: 'estado', label: 'Estado' },
    { key: 'revenue', label: 'Revenue', align: 'right', sortable: true, format: (value) => `€${Number(value ?? 0).toLocaleString('es-ES')}` },
    { key: 'conversion_date', label: 'Conversión', sortable: true, format: formatDate },
  ]

  const updateFilter = (key: keyof FunnelFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS)
    loadRows(EMPTY_FILTERS)
  }

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Trazabilidad Funnel Real
            </CardTitle>
            <p className="mt-1 text-xs font-medium text-[#5C5550]">
              Leads de captación → primera cita de valoración → cita posterior → revenue verificado.
            </p>
          </div>
          <Button onClick={() => loadRows(filters)} disabled={loading} className="gap-2">
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Input type="date" value={filters.lead_from} onChange={(e) => updateFilter('lead_from', e.target.value)} aria-label="Lead desde" />
          <Input type="date" value={filters.lead_to} onChange={(e) => updateFilter('lead_to', e.target.value)} aria-label="Lead hasta" />
          <Input type="date" value={filters.valoracion_from} onChange={(e) => updateFilter('valoracion_from', e.target.value)} aria-label="Valoración desde" />
          <Input type="date" value={filters.valoracion_to} onChange={(e) => updateFilter('valoracion_to', e.target.value)} aria-label="Valoración hasta" />
          <Input type="date" value={filters.posterior_from} onChange={(e) => updateFilter('posterior_from', e.target.value)} aria-label="Posterior desde" />
          <Input type="date" value={filters.posterior_to} onChange={(e) => updateFilter('posterior_to', e.target.value)} aria-label="Posterior hasta" />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => loadRows(filters)} disabled={loading}>Aplicar filtros</Button>
          <Button variant="outline" onClick={resetFilters} disabled={loading}>Limpiar</Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-2xl bg-[#FAF7F2] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5C5550]">Leads</p>
            <p className="mt-2 text-2xl font-serif font-bold text-[#2C2825]">{summary.leads}</p>
          </div>
          <div className="rounded-2xl bg-[#FAF7F2] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5C5550]">Valoraciones</p>
            <p className="mt-2 text-2xl font-serif font-bold text-[#2C2825]">{summary.valoraciones}</p>
          </div>
          <div className="rounded-2xl bg-[#FAF7F2] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5C5550]">Posteriores</p>
            <p className="mt-2 text-2xl font-serif font-bold text-[#2C2825]">{summary.posteriores}</p>
          </div>
          <div className="rounded-2xl bg-[#FAF7F2] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5C5550]">Revenue</p>
            <p className="mt-2 text-2xl font-serif font-bold text-primary">€{summary.revenue.toLocaleString('es-ES')}</p>
          </div>
        </div>

        <SortableTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyMessage="No hay filas de funnel para los filtros seleccionados."
          exportFilename="trazabilidad-funnel-real"
        />
      </CardContent>
    </Card>
  )
}
