import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { supabase } from '../../lib/supabaseClient'

type DetailRow = {
  record_id: string
  event_at: string | null
  channel_group: string
  channel_source: string | null
  campaign_name: string | null
  client_name: string | null
  revenue: number | string | null
  is_real_client: boolean | null
  is_new_client_by_channel: boolean | null
}

type SummaryRow = {
  key: string
  channel: string
  source: string
  contacts: number
  realClients: number
  newByChannel: number
  conversion: number
  revenue: number
  cac: number | null
  lastClient: string | null
  lastClientDate: string | null
}

function toNumber(value: number | string | null | undefined) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return `${Number(value).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`
}

function formatDate(value: string | null | undefined) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('es-ES')
}

function channelLabel(channel: string | null | undefined) {
  if (channel === 'social') return 'Redes sociales'
  if (channel === 'other') return 'Otros canales'
  return channel || 'Sin canal'
}

function clientKey(row: DetailRow) {
  const name = String(row.client_name ?? '').trim().toLowerCase()
  return name || row.record_id
}

interface PatientConversionSectionProps {
  readonly sourceFilter: string
  readonly campaignId: string
  readonly from: string
  readonly to: string
  readonly attributedSpend?: number | null
}

export function PatientConversionSection({ sourceFilter, campaignId, from, to, attributedSpend = null }: PatientConversionSectionProps) {
  const [detail, setDetail] = useState<DetailRow[]>([])
  const [channelFilter, setChannelFilter] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const days = useMemo(() => {
    const d1 = new Date(from).getTime()
    const d2 = new Date(to).getTime()
    if (!Number.isFinite(d1) || !Number.isFinite(d2)) return 0
    return Math.max(1, Math.ceil(Math.abs(d2 - d1) / 86_400_000) + 1)
  }, [from, to])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError(null)

      let query = supabase
        .from('v_new_clients_by_channel_detail')
        .select('*')
        .gte('event_at', from)
        .lte('event_at', to)
        .order('event_at', { ascending: false })
        .limit(800)

      if (sourceFilter !== 'ALL') query = query.eq('channel_source', sourceFilter)
      if (campaignId !== 'ALL') query = query.eq('campaign_name', campaignId)

      const result = await query
      if (!active) return

      if (result.error) {
        setError(result.error.message || 'No se pudo cargar conversión por canal')
        setDetail([])
      } else {
        setDetail((result.data ?? []) as DetailRow[])
      }
      setLoading(false)
    }

    load()
    return () => { active = false }
  }, [sourceFilter, campaignId, from, to])

  const rows = useMemo(() => {
    const grouped = new Map<string, {
      key: string
      channel: string
      source: string
      contacts: Set<string>
      realClients: Set<string>
      newByChannel: Set<string>
      revenue: number
      lastClient: string | null
      lastClientDate: string | null
    }>()

    detail.forEach((row) => {
      const key = `${row.channel_group || 'unknown'}::${row.channel_source || 'unknown'}`
      const current = grouped.get(key) ?? {
        key,
        channel: row.channel_group || 'unknown',
        source: row.channel_source || 'Sin fuente',
        contacts: new Set<string>(),
        realClients: new Set<string>(),
        newByChannel: new Set<string>(),
        revenue: 0,
        lastClient: null,
        lastClientDate: null,
      }

      current.contacts.add(row.record_id || clientKey(row))
      current.revenue += toNumber(row.revenue)

      if (row.is_real_client) {
        current.realClients.add(clientKey(row))
        const rowTime = row.event_at ? new Date(row.event_at).getTime() : 0
        const currentTime = current.lastClientDate ? new Date(current.lastClientDate).getTime() : 0
        if (!current.lastClientDate || rowTime >= currentTime) {
          current.lastClient = row.client_name || 'Cliente sin nombre'
          current.lastClientDate = row.event_at
        }
      }

      if (row.is_new_client_by_channel) current.newByChannel.add(clientKey(row))
      grouped.set(key, current)
    })

    return Array.from(grouped.values()).map((row): SummaryRow => {
      const contacts = row.contacts.size
      const realClients = row.realClients.size
      const isSocial = row.channel === 'social' || row.source.toLowerCase().includes('meta') || row.source.toLowerCase().includes('instagram') || row.source.toLowerCase().includes('facebook')
      return {
        key: row.key,
        channel: row.channel,
        source: row.source,
        contacts,
        realClients,
        newByChannel: row.newByChannel.size,
        conversion: contacts > 0 ? Number(((realClients / contacts) * 100).toFixed(1)) : 0,
        revenue: row.revenue,
        cac: isSocial && realClients > 0 && Number(attributedSpend) > 0 ? Number((Number(attributedSpend) / realClients).toFixed(0)) : null,
        lastClient: row.lastClient,
        lastClientDate: row.lastClientDate,
      }
    }).sort((a, b) => b.realClients - a.realClients || b.revenue - a.revenue)
  }, [detail, attributedSpend])

  const visibleRows = channelFilter === 'ALL' ? rows : rows.filter((row) => row.channel === channelFilter)
  const channels = Array.from(new Set(rows.map((row) => row.channel))).filter(Boolean)
  const totals = visibleRows.reduce((acc, row) => ({
    contacts: acc.contacts + row.contacts,
    realClients: acc.realClients + row.realClients,
    newByChannel: acc.newByChannel + row.newByChannel,
    revenue: acc.revenue + row.revenue,
  }), { contacts: 0, realClients: 0, newByChannel: 0, revenue: 0 })
  const totalConversion = totals.contacts > 0 ? Number(((totals.realClients / totals.contacts) * 100).toFixed(1)) : 0

  if (loading) return <Card className="border-none rounded-[2.5rem] bg-white/70 p-8 text-[#8E8680]">Cargando conversión por canal...</Card>

  return (
    <Card className="border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] overflow-hidden bg-white/80 backdrop-blur-md rounded-[2.5rem]">
      <CardHeader className="border-b border-[#E5D5C5]/20 px-8 pt-8 pb-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <CardTitle className="font-serif text-3xl text-[#2C2825]">Conversión real por canal</CardTitle>
            <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[#8E8680] font-bold">Contactos, clientes reales, revenue y CAC atribuido · últimos {days} días</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{totals.contacts}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">contactos únicos</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{totals.realClients}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">clientes reales</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{totalConversion.toLocaleString('es-ES')}%</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">conversión</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{formatMoney(totals.revenue)}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">revenue</div></div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-8 space-y-8">
        {error && <div className="rounded-2xl bg-red-50 text-red-700 p-4 text-sm">{error}</div>}
        <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} className="rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white">
          <option value="ALL">Todos los canales</option>
          {channels.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}
        </select>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-[10px] uppercase tracking-[0.18em] text-[#8E8680] border-b border-[#E5D5C5]/50"><th className="py-3 pr-4">Canal</th><th className="py-3 pr-4">Contactos únicos</th><th className="py-3 pr-4">Clientes reales</th><th className="py-3 pr-4">Nuevos por canal</th><th className="py-3 pr-4">Conversión</th><th className="py-3 pr-4">Revenue</th><th className="py-3 pr-4">CAC atribuido</th><th className="py-3 pr-4">Último cliente real</th></tr></thead>
            <tbody>
              {visibleRows.map((row) => (<tr key={row.key} className="border-b border-[#E5D5C5]/20"><td className="py-4 pr-4"><div className="font-bold text-[#2C2825]">{channelLabel(row.channel)}</div><div className="text-xs text-[#8E8680]">{row.source}</div></td><td className="py-4 pr-4">{row.contacts}</td><td className="py-4 pr-4">{row.realClients}</td><td className="py-4 pr-4">{row.newByChannel}</td><td className="py-4 pr-4">{row.conversion.toLocaleString('es-ES')}%</td><td className="py-4 pr-4">{formatMoney(row.revenue)}</td><td className="py-4 pr-4">{formatMoney(row.cac)}</td><td className="py-4 pr-4">{row.lastClient ? <><div className="font-semibold text-[#2C2825]">{row.lastClient}</div><div className="text-xs text-[#8E8680]">{formatDate(row.lastClientDate)}</div></> : '—'}</td></tr>))}
              {visibleRows.length === 0 && <tr><td className="py-8 text-center text-[#8E8680]" colSpan={8}>Sin datos para el rango y filtros seleccionados.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
