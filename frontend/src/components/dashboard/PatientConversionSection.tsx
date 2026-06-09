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
  revenue: number | string | null
  is_real_client: boolean | null
  is_new_client_by_channel: boolean | null
  is_new_client_global: boolean | null
  source_record_type: string | null
}

type SummaryRow = {
  key: string
  channel: string
  source: string
  agenda: string
  contacts: number
  attributablePatients: number
  paidPatients: number
  newByChannel: number
  contactOnly: number
  conversion: number
  revenue: number
  cac: number | null
  lastPatient: string | null
  lastPatientDate: string | null
}

type PatientRow = {
  key: string
  name: string
  lastDate: string | null
  channel: string
  source: string
  agenda: string
  classification: string
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
  if (!agenda) return 'Sin agenda'
  if (agenda.toUpperCase().includes('JJRT')) return 'Medicina estética · Javier Rivera'
  if (agenda.toUpperCase().includes('ENFERMER')) return 'Enfermería y dermocosmética'
  return agenda
}

function clientKey(row: DetailRow) {
  const identity = String(row.identity_key ?? '').trim().toLowerCase()
  const phone = String(row.phone_normalized ?? '').trim().toLowerCase()
  const email = String(row.email_normalized ?? '').trim().toLowerCase()
  const name = String(row.client_name ?? '').trim().toLowerCase()
  return identity || phone || email || name || row.record_id
}

function classifyPatient(row: Pick<PatientRow, 'revenue'> & { attributable: boolean }) {
  if (row.revenue > 0) return 'Paciente pagado'
  if (row.attributable) return 'Paciente atribuible'
  return 'Solo contacto'
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
        .limit(800)

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

  const rows = useMemo(() => {
    const grouped = new Map<string, { key: string; channel: string; source: string; agenda: string; contacts: Set<string>; attributablePatients: Set<string>; paidPatients: Set<string>; newByChannel: Set<string>; revenue: number; lastPatient: string | null; lastPatientDate: string | null }>()

    detail.forEach((row) => {
      const source = row.channel_source || 'Sin fuente'
      const agenda = row.campaign_name || 'Sin agenda'
      const key = `${row.channel_group || 'unknown'}::${source}::${agenda}`
      const current = grouped.get(key) ?? { key, channel: row.channel_group || 'unknown', source, agenda, contacts: new Set<string>(), attributablePatients: new Set<string>(), paidPatients: new Set<string>(), newByChannel: new Set<string>(), revenue: 0, lastPatient: null, lastPatientDate: null }
      const personKey = clientKey(row)
      const revenue = toNumber(row.revenue)
      current.contacts.add(personKey)
      current.revenue += revenue
      if (row.is_real_client) {
        current.attributablePatients.add(personKey)
        const rowTime = row.event_at ? new Date(row.event_at).getTime() : 0
        const currentTime = current.lastPatientDate ? new Date(current.lastPatientDate).getTime() : 0
        if (!current.lastPatientDate || rowTime >= currentTime) {
          current.lastPatient = row.client_name || 'Paciente sin nombre'
          current.lastPatientDate = row.event_at
        }
      }
      if (revenue > 0) current.paidPatients.add(personKey)
      if (row.is_new_client_by_channel) current.newByChannel.add(personKey)
      grouped.set(key, current)
    })

    return Array.from(grouped.values()).map((row): SummaryRow => {
      const contacts = row.contacts.size
      const attributablePatients = row.attributablePatients.size
      const isSocial = row.channel === 'social' || row.source.toLowerCase().includes('meta') || row.source.toLowerCase().includes('instagram') || row.source.toLowerCase().includes('facebook')
      return { key: row.key, channel: row.channel, source: row.source, agenda: row.agenda, contacts, attributablePatients, paidPatients: row.paidPatients.size, newByChannel: row.newByChannel.size, contactOnly: Math.max(contacts - attributablePatients, 0), conversion: contacts > 0 ? Number(((attributablePatients / contacts) * 100).toFixed(1)) : 0, revenue: row.revenue, cac: isSocial && attributablePatients > 0 && Number(attributedSpend) > 0 ? Number((Number(attributedSpend) / attributablePatients).toFixed(0)) : null, lastPatient: row.lastPatient, lastPatientDate: row.lastPatientDate }
    }).sort((a, b) => b.attributablePatients - a.attributablePatients || b.paidPatients - a.paidPatients || b.revenue - a.revenue)
  }, [detail, attributedSpend])

  const channels = Array.from(new Set(rows.map((row) => row.channel))).filter(Boolean)
  const agendas = Array.from(new Set(rows.map((row) => row.agenda))).filter(Boolean).sort()
  const visibleRows = rows.filter((row) => (channelFilter === 'ALL' || row.channel === channelFilter) && (agendaFilter === 'ALL' || row.agenda === agendaFilter))
  const totals = visibleRows.reduce((acc, row) => ({ contacts: acc.contacts + row.contacts, attributablePatients: acc.attributablePatients + row.attributablePatients, paidPatients: acc.paidPatients + row.paidPatients, newByChannel: acc.newByChannel + row.newByChannel, contactOnly: acc.contactOnly + row.contactOnly, revenue: acc.revenue + row.revenue }), { contacts: 0, attributablePatients: 0, paidPatients: 0, newByChannel: 0, contactOnly: 0, revenue: 0 })
  const totalConversion = totals.contacts > 0 ? Number(((totals.attributablePatients / totals.contacts) * 100).toFixed(1)) : 0

  const visiblePatients = useMemo(() => {
    const filtered = detail.filter((row) => {
      const agenda = row.campaign_name || 'Sin agenda'
      return (channelFilter === 'ALL' || row.channel_group === channelFilter) && (agendaFilter === 'ALL' || agenda === agendaFilter)
    })
    const grouped = new Map<string, PatientRow & { attributable: boolean }>()

    filtered.forEach((row) => {
      const source = row.channel_source || 'Sin fuente'
      const agenda = row.campaign_name || 'Sin agenda'
      const key = `${row.channel_group || 'unknown'}::${source}::${agenda}::${clientKey(row)}`
      const revenue = toNumber(row.revenue)
      const current = grouped.get(key)
      const rowTime = row.event_at ? new Date(row.event_at).getTime() : 0
      const currentTime = current?.lastDate ? new Date(current.lastDate).getTime() : -1
      const next = current ?? { key, name: row.client_name || 'Paciente sin nombre', lastDate: row.event_at, channel: row.channel_group || 'unknown', source, agenda, classification: 'Solo contacto', isNewByChannel: false, isNewGlobal: false, revenue: 0, attributable: false }
      next.revenue += revenue
      next.attributable = next.attributable || Boolean(row.is_real_client)
      next.isNewByChannel = next.isNewByChannel || Boolean(row.is_new_client_by_channel)
      next.isNewGlobal = next.isNewGlobal || Boolean(row.is_new_client_global)
      if (rowTime >= currentTime) {
        next.name = row.client_name || next.name
        next.lastDate = row.event_at
      }
      next.classification = classifyPatient(next)
      grouped.set(key, next)
    })

    return Array.from(grouped.values()).sort((a, b) => new Date(b.lastDate || 0).getTime() - new Date(a.lastDate || 0).getTime())
  }, [detail, channelFilter, agendaFilter])

  if (loading) return <Card className="border-none rounded-[2.5rem] bg-white/70 p-8 text-[#8E8680]">Cargando clasificación de pacientes...</Card>

  return (
    <Card className="border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] overflow-hidden bg-white/80 backdrop-blur-md rounded-[2.5rem]">
      <CardHeader className="border-b border-[#E5D5C5]/20 px-8 pt-8 pb-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <CardTitle className="font-serif text-3xl text-[#2C2825]">Clasificación de pacientes por canal y agenda</CardTitle>
            <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[#8E8680] font-bold">Javier Rivera / valoración-tratamiento separado de enfermería y post-tratamiento · últimos {days} días</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-center">
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{totals.contacts}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">contactos únicos</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{totals.attributablePatients}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">pacientes atribuibles</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{totals.paidPatients}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">pacientes pagados</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{totalConversion.toLocaleString('es-ES')}%</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">conversión a paciente</div></div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4"><div className="text-2xl font-serif font-bold text-[#2C2825]">{formatMoney(totals.revenue)}</div><div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">revenue</div></div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-8 space-y-8">
        {error && <div className="rounded-2xl bg-red-50 text-red-700 p-4 text-sm">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} className="rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white">
            <option value="ALL">Todos los canales</option>
            {channels.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}
          </select>
          <select value={agendaFilter} onChange={(event) => setAgendaFilter(event.target.value)} className="rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white">
            <option value="ALL">Todas las agendas</option>
            {agendas.map((agenda) => <option key={agenda} value={agenda}>{agendaLabel(agenda)}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-[10px] uppercase tracking-[0.18em] text-[#8E8680] border-b border-[#E5D5C5]/50"><th className="py-3 pr-4">Canal</th><th className="py-3 pr-4">Agenda / área</th><th className="py-3 pr-4">Contactos únicos</th><th className="py-3 pr-4">Pacientes atribuibles</th><th className="py-3 pr-4">Pacientes pagados</th><th className="py-3 pr-4">Nuevos por canal</th><th className="py-3 pr-4">Solo contacto</th><th className="py-3 pr-4">Conversión a paciente</th><th className="py-3 pr-4">Revenue</th><th className="py-3 pr-4">CAC atribuido</th><th className="py-3 pr-4">Último paciente</th></tr></thead>
            <tbody>
              {visibleRows.map((row) => (<tr key={row.key} className="border-b border-[#E5D5C5]/20"><td className="py-4 pr-4"><div className="font-bold text-[#2C2825]">{channelLabel(row.channel)}</div><div className="text-xs text-[#8E8680]">{row.source}</div></td><td className="py-4 pr-4 font-semibold text-[#2C2825]">{agendaLabel(row.agenda)}</td><td className="py-4 pr-4">{row.contacts}</td><td className="py-4 pr-4">{row.attributablePatients}</td><td className="py-4 pr-4">{row.paidPatients}</td><td className="py-4 pr-4">{row.newByChannel}</td><td className="py-4 pr-4">{row.contactOnly}</td><td className="py-4 pr-4">{row.conversion.toLocaleString('es-ES')}%</td><td className="py-4 pr-4">{formatMoney(row.revenue)}</td><td className="py-4 pr-4">{formatMoney(row.cac)}</td><td className="py-4 pr-4">{row.lastPatient ? <><div className="font-semibold text-[#2C2825]">{row.lastPatient}</div><div className="text-xs text-[#8E8680]">{formatDate(row.lastPatientDate)}</div></> : '—'}</td></tr>))}
              {visibleRows.length === 0 && <tr><td className="py-8 text-center text-[#8E8680]" colSpan={11}>Sin datos para el rango y filtros seleccionados.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="space-y-4">
          <div><h3 className="font-serif text-2xl text-[#2C2825]">Pacientes incluidos en el filtro</h3><p className="text-xs uppercase tracking-[0.18em] text-[#8E8680] font-bold">Listado nominal único según canal y agenda seleccionados</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="text-[10px] uppercase tracking-[0.18em] text-[#8E8680] border-b border-[#E5D5C5]/50"><th className="py-3 pr-4">Paciente</th><th className="py-3 pr-4">Fecha</th><th className="py-3 pr-4">Canal</th><th className="py-3 pr-4">Agenda / área</th><th className="py-3 pr-4">Clasificación</th><th className="py-3 pr-4">Nuevo canal</th><th className="py-3 pr-4">Nuevo global</th><th className="py-3 pr-4">Revenue</th></tr></thead>
              <tbody>
                {visiblePatients.map((row) => (<tr key={row.key} className="border-b border-[#E5D5C5]/20"><td className="py-3 pr-4 font-semibold text-[#2C2825]">{row.name}</td><td className="py-3 pr-4">{formatDate(row.lastDate)}</td><td className="py-3 pr-4"><div>{channelLabel(row.channel)}</div><div className="text-xs text-[#8E8680]">{row.source}</div></td><td className="py-3 pr-4">{agendaLabel(row.agenda)}</td><td className="py-3 pr-4">{row.classification}</td><td className="py-3 pr-4">{row.isNewByChannel ? 'Sí' : 'No'}</td><td className="py-3 pr-4">{row.isNewGlobal ? 'Sí' : 'No'}</td><td className="py-3 pr-4">{formatMoney(row.revenue)}</td></tr>))}
                {visiblePatients.length === 0 && <tr><td className="py-8 text-center text-[#8E8680]" colSpan={8}>Sin pacientes para el filtro seleccionado.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
