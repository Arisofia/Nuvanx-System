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
  phone_normalized?: string | null
  email_normalized?: string | null
  identity_key?: string | null
  treatment_name?: string | null
  revenue: number | string | null
  is_new_client_by_channel: boolean | null
  is_new_client_global: boolean | null
}

type FunnelTypeRow = {
  key: string
  clientType: string
  agenda: string
  channel: string
  source: string
  patientKeys: Set<string>
  newInChannelKeys: Set<string>
  revenue: number
  lastPatient: string | null
  lastDate: string | null
}

type PatientRow = {
  key: string
  name: string
  lastDate: string | null
  clientType: string
  agenda: string
  channel: string
  source: string
  treatment: string
  isNewByChannel: boolean
  isNewGlobal: boolean
  revenue: number
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
  if (!value) return '—'
  return new Date(value).toLocaleDateString('es-ES')
}

function channelLabel(channel: string | null | undefined) {
  if (channel === 'social') return 'Redes sociales'
  if (channel === 'other') return 'Otros canales'
  return channel || 'Sin canal'
}

function agendaLabel(value: string | null | undefined) {
  const agenda = String(value ?? '').trim()
  const upper = agenda.toUpperCase()
  if (!agenda) return 'Sin agenda'
  if (upper.includes('JJRT')) return 'Medicina estética · Javier Rivera'
  if (upper.includes('ENFERMER')) return 'Enfermería y dermocosmética'
  return agenda
}

function clientKey(row: DetailRow) {
  const identity = String(row.identity_key ?? '').trim().toLowerCase()
  const phone = String(row.phone_normalized ?? '').trim().toLowerCase()
  const email = String(row.email_normalized ?? '').trim().toLowerCase()
  const name = String(row.client_name ?? '').trim().toLowerCase()
  return identity || phone || email || name || row.record_id
}

function clientTypeLabel(row: DetailRow) {
  const treatment = String(row.treatment_name ?? '').toUpperCase()
  const agenda = String(row.campaign_name ?? '').toUpperCase()
  const channel = String(row.channel_group ?? '').toLowerCase()

  if (channel === 'social') return 'Lead Meta'
  if (treatment.includes('PRIMERA VISITA')) return 'Primera visita'
  if (agenda.includes('ENFERMER')) return 'Enfermería / post-tratamiento'
  if (treatment.includes('REVISIÓN') || treatment.includes('REVISION')) return 'Revisión / seguimiento'
  if (agenda.includes('JJRT')) return 'Valoración / tratamiento médico'
  return 'Otros servicios'
}

interface PatientConversionSectionProps {
  readonly sourceFilter: string
  readonly campaignId: string
  readonly from: string
  readonly to: string
  readonly attributedSpend?: number | null
}

export function PatientConversionSection({ sourceFilter, campaignId, from, to }: PatientConversionSectionProps) {
  const [detail, setDetail] = useState<DetailRow[]>([])
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [agendaFilter, setAgendaFilter] = useState('ALL')
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
        .limit(1000)

      if (sourceFilter !== 'ALL') query = query.eq('channel_source', sourceFilter)
      if (campaignId !== 'ALL') query = query.eq('campaign_name', campaignId)

      const result = await query
      if (!active) return

      if (result.error) {
        setError(result.error.message || 'No se pudo cargar la clasificación de pacientes')
        setDetail([])
      } else {
        setDetail((result.data ?? []) as DetailRow[])
      }
      setLoading(false)
    }

    load()
    return () => { active = false }
  }, [sourceFilter, campaignId, from, to])

  const filteredDetail = useMemo(() => detail.filter((row) => {
    const type = clientTypeLabel(row)
    const agenda = row.campaign_name || 'Sin agenda'
    return (typeFilter === 'ALL' || type === typeFilter) && (agendaFilter === 'ALL' || agenda === agendaFilter)
  }), [detail, typeFilter, agendaFilter])

  const rows = useMemo(() => {
    const grouped = new Map<string, FunnelTypeRow>()

    filteredDetail.forEach((row) => {
      const type = clientTypeLabel(row)
      const agenda = row.campaign_name || 'Sin agenda'
      const source = row.channel_source || 'Sin fuente'
      const channel = row.channel_group || 'unknown'
      const key = `${type}::${agenda}::${channel}::${source}`
      const current = grouped.get(key) ?? { key, clientType: type, agenda, channel, source, patientKeys: new Set<string>(), newInChannelKeys: new Set<string>(), revenue: 0, lastPatient: null, lastDate: null }
      const patientKey = clientKey(row)
      const rowTime = row.event_at ? new Date(row.event_at).getTime() : 0
      const currentTime = current.lastDate ? new Date(current.lastDate).getTime() : 0

      current.patientKeys.add(patientKey)
      if (row.is_new_client_by_channel) current.newInChannelKeys.add(patientKey)
      current.revenue += toNumber(row.revenue)
      if (!current.lastDate || rowTime >= currentTime) {
        current.lastPatient = row.client_name || 'Paciente sin nombre'
        current.lastDate = row.event_at
      }
      grouped.set(key, current)
    })

    return Array.from(grouped.values()).sort((a, b) => b.patientKeys.size - a.patientKeys.size || b.revenue - a.revenue)
  }, [filteredDetail])

  const patients = useMemo(() => {
    const grouped = new Map<string, PatientRow>()

    filteredDetail.forEach((row) => {
      const type = clientTypeLabel(row)
      const agenda = row.campaign_name || 'Sin agenda'
      const source = row.channel_source || 'Sin fuente'
      const channel = row.channel_group || 'unknown'
      const key = `${clientKey(row)}::${type}::${agenda}`
      const revenue = toNumber(row.revenue)
      const current = grouped.get(key)
      const rowTime = row.event_at ? new Date(row.event_at).getTime() : 0
      const currentTime = current?.lastDate ? new Date(current.lastDate).getTime() : -1
      const next = current ?? { key, name: row.client_name || 'Paciente sin nombre', lastDate: row.event_at, clientType: type, agenda, channel, source, treatment: row.treatment_name || 'Sin tratamiento', isNewByChannel: false, isNewGlobal: false, revenue: 0 }

      next.revenue += revenue
      next.isNewByChannel = next.isNewByChannel || Boolean(row.is_new_client_by_channel)
      next.isNewGlobal = next.isNewGlobal || Boolean(row.is_new_client_global)
      if (rowTime >= currentTime) {
        next.name = row.client_name || next.name
        next.lastDate = row.event_at
        next.treatment = row.treatment_name || next.treatment
        next.channel = channel
        next.source = source
      }
      grouped.set(key, next)
    })

    return Array.from(grouped.values()).sort((a, b) => new Date(b.lastDate || 0).getTime() - new Date(a.lastDate || 0).getTime())
  }, [filteredDetail])

  const typeOptions = Array.from(new Set(detail.map(clientTypeLabel))).sort()
  const agendaOptions = Array.from(new Set(detail.map((row) => row.campaign_name || 'Sin agenda'))).sort()
  const totalPatients = new Set(filteredDetail.map(clientKey)).size
  const newInChannel = new Set(filteredDetail.filter((row) => row.is_new_client_by_channel).map(clientKey)).size
  const totalRevenue = filteredDetail.reduce((sum, row) => sum + toNumber(row.revenue), 0)

  if (loading) return <Card className="border-none rounded-[2.5rem] bg-white/70 p-8 text-[#8E8680]">Cargando tipos de cliente...</Card>

  return (
    <Card className="border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] overflow-hidden bg-white/80 backdrop-blur-md rounded-[2.5rem]">
      <CardHeader className="border-b border-[#E5D5C5]/20 px-8 pt-8 pb-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <CardTitle className="font-serif text-3xl text-[#2C2825]">Tipos de cliente del funnel</CardTitle>
            <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[#8E8680] font-bold">Pacientes únicos por etiqueta de funnel y agenda · últimos {days} días</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-center">
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{totalPatients}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">pacientes únicos</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{newInChannel}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">nuevos por canal</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{formatMoney(totalRevenue)}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">revenue</div></div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-8 space-y-8">
        {error && <div className="rounded-2xl bg-red-50 text-red-700 p-4 text-sm">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white">
            <option value="ALL">Todos los tipos de cliente</option>
            {typeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select value={agendaFilter} onChange={(event) => setAgendaFilter(event.target.value)} className="rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white">
            <option value="ALL">Todas las agendas</option>
            {agendaOptions.map((agenda) => <option key={agenda} value={agenda}>{agendaLabel(agenda)}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-[10px] uppercase tracking-[0.18em] text-[#8E8680] border-b border-[#E5D5C5]/50"><th className="py-3 pr-4">Tipo de cliente</th><th className="py-3 pr-4">Agenda / área</th><th className="py-3 pr-4">Canal</th><th className="py-3 pr-4">Pacientes únicos</th><th className="py-3 pr-4">Nuevos por canal</th><th className="py-3 pr-4">Revenue</th><th className="py-3 pr-4">Último paciente</th></tr></thead>
            <tbody>
              {rows.map((row) => (<tr key={row.key} className="border-b border-[#E5D5C5]/20"><td className="py-4 pr-4 font-bold text-[#2C2825]">{row.clientType}</td><td className="py-4 pr-4">{agendaLabel(row.agenda)}</td><td className="py-4 pr-4"><div>{channelLabel(row.channel)}</div><div className="text-xs text-[#8E8680]">{row.source}</div></td><td className="py-4 pr-4">{row.patientKeys.size}</td><td className="py-4 pr-4">{row.newInChannelKeys.size}</td><td className="py-4 pr-4">{formatMoney(row.revenue)}</td><td className="py-4 pr-4">{row.lastPatient ? <><div className="font-semibold text-[#2C2825]">{row.lastPatient}</div><div className="text-xs text-[#8E8680]">{formatDate(row.lastDate)}</div></> : '—'}</td></tr>))}
              {rows.length === 0 && <tr><td className="py-8 text-center text-[#8E8680]" colSpan={7}>Sin datos para el filtro seleccionado.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="space-y-4">
          <div><h3 className="font-serif text-2xl text-[#2C2825]">Pacientes incluidos en el filtro</h3><p className="text-xs uppercase tracking-[0.18em] text-[#8E8680] font-bold">Listado nominal único según tipo de cliente y agenda</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="text-[10px] uppercase tracking-[0.18em] text-[#8E8680] border-b border-[#E5D5C5]/50"><th className="py-3 pr-4">Paciente</th><th className="py-3 pr-4">Fecha</th><th className="py-3 pr-4">Tipo de cliente</th><th className="py-3 pr-4">Agenda / área</th><th className="py-3 pr-4">Tratamiento</th><th className="py-3 pr-4">Nuevo canal</th><th className="py-3 pr-4">Revenue</th></tr></thead>
              <tbody>
                {patients.map((row) => (<tr key={row.key} className="border-b border-[#E5D5C5]/20"><td className="py-3 pr-4 font-semibold text-[#2C2825]">{row.name}</td><td className="py-3 pr-4">{formatDate(row.lastDate)}</td><td className="py-3 pr-4">{row.clientType}</td><td className="py-3 pr-4">{agendaLabel(row.agenda)}</td><td className="py-3 pr-4">{row.treatment}</td><td className="py-3 pr-4">{row.isNewByChannel ? 'Sí' : 'No'}</td><td className="py-3 pr-4">{formatMoney(row.revenue)}</td></tr>))}
                {patients.length === 0 && <tr><td className="py-8 text-center text-[#8E8680]" colSpan={7}>Sin pacientes para el filtro seleccionado.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
