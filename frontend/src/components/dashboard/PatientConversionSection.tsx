import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { supabase } from '../../lib/supabaseClient'

type MonthlyRow = {
  month_key: string
  channel_group: 'social' | 'other' | string
  channel_source: string | null
  campaign_name: string | null
  client_touchpoints_unique: number | string | null
  real_clients_unique: number | string | null
  new_clients_unique_by_channel: number | string | null
  new_clients_unique_global: number | string | null
  revenue: number | string | null
  client_conversion_rate_pct: number | string | null
}

type DetailRow = {
  record_id: string
  event_at: string | null
  month_key: string
  channel_group: 'social' | 'other' | string
  channel_source: string | null
  campaign_name: string | null
  client_name: string | null
  treatment_name: string | null
  revenue: number | string | null
  is_real_client: boolean | null
  is_new_client_by_channel: boolean | null
  is_new_client_global: boolean | null
  source_record_type: string | null
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatMoney(value: number | string | null | undefined) {
  return `${toNumber(value).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('es-ES')
}

function channelLabel(channel: string | null | undefined) {
  if (channel === 'social') return 'Redes sociales'
  if (channel === 'other') return 'Otros canales'
  return channel || 'Sin canal'
}

interface PatientConversionSectionProps {
  readonly sourceFilter: string
  readonly campaignId: string
  readonly customFrom: string
  readonly customTo: string
}

export function PatientConversionSection({ sourceFilter, campaignId, customFrom, customTo }: PatientConversionSectionProps) {
  const [monthly, setMonthly] = useState<MonthlyRow[]>([])
  const [detail, setDetail] = useState<DetailRow[]>([])
  const [monthFilter, setMonthFilter] = useState('ALL')
  const [channelFilter, setChannelFilter] = useState('ALL')
  const [clientFilter, setClientFilter] = useState('ALL')
  const [nameSearch, setNameSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError(null)

      let monthlyQuery = supabase
        .from('v_new_clients_by_channel_monthly')
        .select('*')
        .order('month_key', { ascending: false })

      let detailQuery = supabase
        .from('v_new_clients_by_channel_detail')
        .select('*')
        .order('event_at', { ascending: false })
        .limit(800)

      if (sourceFilter !== 'ALL') {
        monthlyQuery = monthlyQuery.eq('channel_source', sourceFilter)
        detailQuery = detailQuery.eq('channel_source', sourceFilter)
      }
      if (campaignId !== 'ALL') {
        monthlyQuery = monthlyQuery.eq('campaign_name', campaignId)
        detailQuery = detailQuery.eq('campaign_name', campaignId)
      }
      if (customFrom) detailQuery = detailQuery.gte('event_at', customFrom)
      if (customTo) detailQuery = detailQuery.lte('event_at', `${customTo}T23:59:59`)

      const [monthlyResult, detailResult] = await Promise.all([monthlyQuery, detailQuery])
      if (!active) return

      if (monthlyResult.error || detailResult.error) {
        setError(monthlyResult.error?.message || detailResult.error?.message || 'No se pudo cargar clientes nuevos')
        setMonthly([])
        setDetail([])
      } else {
        setMonthly((monthlyResult.data ?? []) as MonthlyRow[])
        setDetail((detailResult.data ?? []) as DetailRow[])
      }
      setLoading(false)
    }

    load()
    return () => { active = false }
  }, [sourceFilter, campaignId, customFrom, customTo])

  const months = useMemo(() => Array.from(new Set(detail.map((row) => row.month_key).filter(Boolean))).sort().reverse(), [detail])

  const visibleDetail = useMemo(() => {
    const search = nameSearch.trim().toLowerCase()
    return detail.filter((row) => {
      if (monthFilter !== 'ALL' && row.month_key !== monthFilter) return false
      if (channelFilter !== 'ALL' && row.channel_group !== channelFilter) return false
      if (clientFilter === 'NEW' && !row.is_new_client_by_channel) return false
      if (clientFilter === 'REAL' && !row.is_real_client) return false
      if (clientFilter === 'TOUCHPOINT' && row.is_real_client) return false
      if (search && !String(row.client_name ?? '').toLowerCase().includes(search)) return false
      return true
    })
  }, [detail, monthFilter, channelFilter, clientFilter, nameSearch])

  const filteredMonthly = useMemo(() => monthly.filter((row) => {
    if (monthFilter !== 'ALL' && row.month_key !== monthFilter) return false
    if (channelFilter !== 'ALL' && row.channel_group !== channelFilter) return false
    return true
  }), [monthly, monthFilter, channelFilter])

  const totals = useMemo(() => filteredMonthly.reduce((acc, row) => ({
    touchpoints: acc.touchpoints + toNumber(row.client_touchpoints_unique),
    real: acc.real + toNumber(row.real_clients_unique),
    newByChannel: acc.newByChannel + toNumber(row.new_clients_unique_by_channel),
    revenue: acc.revenue + toNumber(row.revenue),
  }), { touchpoints: 0, real: 0, newByChannel: 0, revenue: 0 }), [filteredMonthly])

  if (loading) return <Card className="border-none rounded-[2.5rem] bg-white/70 p-8 text-[#8E8680]">Cargando clientes nuevos...</Card>

  return (
    <Card className="border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] overflow-hidden bg-white/80 backdrop-blur-md rounded-[2.5rem]">
      <CardHeader className="border-b border-[#E5D5C5]/20 px-8 pt-8 pb-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <CardTitle className="font-serif text-3xl text-[#2C2825]">Clientes nuevos por canal</CardTitle>
            <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[#8E8680] font-bold">
              Redes sociales vs. otros canales · clientes únicos reales
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{totals.touchpoints}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">contactos únicos</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{totals.real}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">clientes reales</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{totals.newByChannel}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">nuevos por canal</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{formatMoney(totals.revenue)}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">revenue</div></div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-8 space-y-8">
        {error && <div className="rounded-2xl bg-red-50 text-red-700 p-4 text-sm">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} className="rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white"><option value="ALL">Todos los meses</option>{months.map((month) => <option key={month} value={month}>{month}</option>)}</select>
          <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} className="rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white"><option value="ALL">Todos los canales</option><option value="social">Redes sociales</option><option value="other">Otros canales</option></select>
          <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className="rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white"><option value="ALL">Todos</option><option value="NEW">Nuevo por canal</option><option value="REAL">Cliente real</option><option value="TOUCHPOINT">Solo contacto</option></select>
          <input value={nameSearch} onChange={(event) => setNameSearch(event.target.value)} placeholder="Buscar por nombre" className="md:col-span-2 rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white" />
        </div>

        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-[10px] uppercase tracking-[0.18em] text-[#8E8680] border-b border-[#E5D5C5]/50"><th className="py-3 pr-4">Mes</th><th className="py-3 pr-4">Canal</th><th className="py-3 pr-4">Fuente</th><th className="py-3 pr-4">Clientes reales</th><th className="py-3 pr-4">Nuevos canal</th><th className="py-3 pr-4">Conversión</th><th className="py-3 pr-4">Revenue</th></tr></thead><tbody>{filteredMonthly.map((row) => (<tr key={`${row.month_key}-${row.channel_group}-${row.channel_source}-${row.campaign_name}`} className="border-b border-[#E5D5C5]/20"><td className="py-4 pr-4 font-bold text-[#2C2825]">{row.month_key}</td><td className="py-4 pr-4">{channelLabel(row.channel_group)}</td><td className="py-4 pr-4 text-[#8E8680]">{row.channel_source}</td><td className="py-4 pr-4">{toNumber(row.real_clients_unique)}</td><td className="py-4 pr-4">{toNumber(row.new_clients_unique_by_channel)}</td><td className="py-4 pr-4">{toNumber(row.client_conversion_rate_pct).toLocaleString('es-ES')}%</td><td className="py-4 pr-4">{formatMoney(row.revenue)}</td></tr>))}</tbody></table></div>

        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-[10px] uppercase tracking-[0.18em] text-[#8E8680] border-b border-[#E5D5C5]/50"><th className="py-3 pr-4">Nombre</th><th className="py-3 pr-4">Fecha</th><th className="py-3 pr-4">Canal</th><th className="py-3 pr-4">Fuente</th><th className="py-3 pr-4">Estado</th><th className="py-3 pr-4">Tipo</th><th className="py-3 pr-4">Revenue</th></tr></thead><tbody>{visibleDetail.map((row) => (<tr key={`${row.source_record_type}-${row.record_id}`} className="border-b border-[#E5D5C5]/20"><td className="py-3 pr-4 font-bold text-[#2C2825]">{row.client_name || 'Sin nombre'}</td><td className="py-3 pr-4">{formatDate(row.event_at)}</td><td className="py-3 pr-4">{channelLabel(row.channel_group)}</td><td className="py-3 pr-4 text-[#8E8680]">{row.channel_source || '—'}</td><td className="py-3 pr-4">{row.is_new_client_by_channel ? 'Nuevo por canal' : row.is_real_client ? 'Cliente real' : 'Solo contacto'}</td><td className="py-3 pr-4">{row.source_record_type === 'financial_settlement' ? 'Caja / Doctoralia' : 'Lead redes'}</td><td className="py-3 pr-4">{formatMoney(row.revenue)}</td></tr>))}</tbody></table></div>
      </CardContent>
    </Card>
  )
}
