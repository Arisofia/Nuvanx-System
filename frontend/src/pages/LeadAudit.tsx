import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Search, Activity, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { invokeApi } from '../lib/supabaseClient'
import { MetaAccountsInline } from '../components/MetaAccountsNotice'
import { formatMetaAccountIds } from '../config/metaAccounts'

function EmptyState({ message }: Readonly<{ message: string }>) {
  return <p className="text-muted text-sm py-8 text-center">{message}</p>
}

function ErrorState({ message }: Readonly<{ message: string }>) {
  return (
    <div className="p-4 bg-[#D9534F]/8 border border-[#D9534F]/30 rounded-lg flex gap-3">
      <AlertCircle className="w-5 h-5 text-[#D9534F] shrink-0 mt-0.5" />
      <p className="text-sm text-[#D9534F]">{message}</p>
    </div>
  )
}

function isDoctoraliaMatched(row: any) {
  return row.doctoraliaMatched === true
}

export default function LeadAudit() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [matchedOnly, setMatchedOnly] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [campaignName, setCampaignName] = useState('')
  const [phone, setPhone] = useState('')

  useEffect(() => {
    let active = true

    const loadLeadAudit = async () => {
      const params: string[] = []
      if (matchedOnly) params.push('matched=true')
      if (from) params.push(`from=${from}`)
      if (to) params.push(`to=${to}`)
      if (campaignName) params.push(`campaign_name=${encodeURIComponent(campaignName)}`)
      if (phone) params.push(`phone=${encodeURIComponent(phone)}`)
      const qs = params.length ? `?${params.join('&')}` : ''

      setLoading(true)
      setError(null)
      try {
        const data: any = await invokeApi(`/reports/lead-audit${qs}`)
        if (!active) return
        setRows(data?.leads ?? [])
      } catch (err: any) {
        if (!active) return
        setError(err?.message || 'Error cargando auditoría de leads.')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadLeadAudit()

    return () => {
      active = false
    }
  }, [matchedOnly, from, to, campaignName, phone])

  const matchedCount = useMemo(
    () => rows.filter(isDoctoraliaMatched).length,
    [rows],
  )

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div className="space-y-2">
          <h1 className="text-5xl font-serif font-bold tracking-tight text-[#2C2825]">Lead Audit</h1>
          <p className="text-[#5C5550] text-xs uppercase tracking-[0.4em] font-bold">Auditoría de Trazabilidad Meta & Doctoralia</p>
          <MetaAccountsInline context="Lead Audit cruza leads, campañas y formularios asociados a estas cuentas Meta." className="mt-4 max-w-2xl" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-sm bg-white">
          <CardContent className="pt-8">
            <p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Leads Totales</p>
            <p className="text-4xl font-serif font-bold mt-4 tracking-tight text-[#2C2825]">{rows.length}</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-sm bg-white">
          <CardContent className="pt-8">
            <p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Leads Cruzados</p>
            <div className="flex items-center gap-3 mt-4">
              <p className="text-4xl font-serif font-bold tracking-tight text-green-600">{matchedCount}</p>
              <CheckCircle2 className="h-5 w-5 text-green-600/30" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-sm bg-white">
          <CardContent className="pt-8">
            <p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Rango Temporal</p>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-[10px] font-bold text-[#2C2825] bg-[#FAF7F2] px-2 py-1 rounded border border-border/30">{from || 'Inicio'}</span>
              <span className="text-[#8E8680]">→</span>
              <span className="text-[10px] font-bold text-[#2C2825] bg-[#FAF7F2] px-2 py-1 rounded border border-border/30">{to || 'Hoy'}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-sm bg-white">
          <CardContent className="pt-8">
            <p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Filtros Activos</p>
            <div className={`mt-4 px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-[0.15em] border w-fit ${matchedOnly ? 'bg-green-600/5 text-green-600 border-green-600/20' : 'bg-[#FAF7F2] text-[#8E8680] border-border/40'}`}>
              {matchedOnly ? 'Solo Cruzados' : 'Vista Completa'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-md bg-white overflow-hidden">
        <CardHeader className="border-b border-border/10 pb-6">
          <CardTitle className="font-serif text-2xl flex items-center gap-3 text-[#2C2825]">
            <Search className="h-6 w-6 text-primary" />
            Filtros Avanzados
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <label htmlFor="lead-audit-campaign-name" className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.15em] ml-1">Campaña</label>
            <input
              id="lead-audit-campaign-name"
              className="w-full px-5 py-2.5 bg-[#FAF7F2]/40 border border-border/30 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all text-[#2C2825] placeholder:text-[#8E8680]/60"
              type="text"
              value={campaignName}
              onChange={(event) => setCampaignName(event.target.value)}
              placeholder="Nombre de campaña…"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="lead-audit-phone" className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.15em] ml-1">Teléfono</label>
            <input
              id="lead-audit-phone"
              className="w-full px-5 py-2.5 bg-[#FAF7F2]/40 border border-border/30 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all text-[#2C2825] placeholder:text-[#8E8680]/60"
              type="text"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Número de teléfono…"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="lead-audit-from" className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.15em] ml-1">Fecha Desde</label>
            <input
              id="lead-audit-from"
              className="w-full px-5 py-2.5 bg-[#FAF7F2]/40 border border-border/30 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all text-[#2C2825]"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="lead-audit-to" className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.15em] ml-1">Fecha Hasta</label>
            <input
              id="lead-audit-to"
              className="w-full px-5 py-2.5 bg-[#FAF7F2]/40 border border-border/30 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all text-[#2C2825]"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </CardContent>
        <CardContent className="pt-2 pb-10">
          <label className="inline-flex items-center gap-3 bg-[#FAF7F2]/40 px-5 py-2.5 rounded-2xl border border-border/30 cursor-pointer hover:bg-[#FAF7F2]/60 transition-colors">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 transition-all"
              checked={matchedOnly}
              onChange={(event) => setMatchedOnly(event.target.checked)}
            />
            <span className="text-xs font-bold text-[#2C2825] uppercase tracking-wider">Mostrar solo leads cruzados</span>
          </label>
        </CardContent>
      </Card>

      <Card className="border-none shadow-md bg-white overflow-hidden">
        <CardHeader className="border-b border-border/10 pb-6">
          <CardTitle className="font-serif text-2xl flex items-center gap-3 text-[#2C2825]">
            <Activity className="h-6 w-6 text-primary" />
            Resultados de Auditoría
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {loading && (
            <div className="py-20 flex flex-col items-center justify-center gap-4">
              <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-[#8E8680] font-bold uppercase tracking-widest italic">Analizando registros…</p>
            </div>
          )}
          {error && <ErrorState message={error} />}
          {!loading && !error && rows.length === 0 && (
            <EmptyState message="No se encontraron leads con los filtros aplicados." />
          )}
          {!loading && !error && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/10 text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.15em]">
                    <th className="px-5 py-4 font-bold">Lead / Fuente</th>
                    <th className="px-5 py-4 font-bold">Campaña / Form</th>
                    <th className="px-5 py-4 font-bold">Cuenta Meta</th>
                    <th className="px-5 py-4 font-bold">Fecha Lead</th>
                    <th className="px-5 py-4 font-bold">Teléfono Lead</th>
                    <th className="px-5 py-4 font-bold">Cruce / Confianza</th>
                    <th className="px-5 py-4 font-bold">Paciente / Tel.</th>
                    <th className="px-5 py-4 font-bold text-right">Neto €</th>
                    <th className="px-5 py-4 text-center font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/5">
                  {rows.map((row, idx) => {
                    return (
                    <tr key={row.lead_id} className={`group hover:bg-[#FAF7F2]/60 transition-colors ${idx % 2 === 0 ? 'bg-transparent' : 'bg-[#FAF7F2]/20'}`}>
                      <td className="px-5 py-5">
                        <p className="font-serif font-bold text-[#2C2825] text-sm">{row.lead_name ?? '—'}</p>
                        <p className="text-[9px] font-bold text-primary uppercase tracking-widest mt-1.5">{row.source ?? '—'}</p>
                      </td>
                      <td className="px-5 py-5 max-w-[200px]">
                        <p className="text-xs font-semibold text-[#2C2825] truncate" title={row.campaign_name}>{row.campaign_name ?? '—'}</p>
                        <p className="text-[10px] text-[#5C5550] font-medium mt-1 truncate" title={row.form_name}>{row.form_name ?? '—'}</p>
                      </td>
                      <td className="px-5 py-5 text-[10px] font-bold text-[#5C5550] whitespace-nowrap">
                        {row.ad_account_id ?? row.account_id ?? formatMetaAccountIds()}
                      </td>
                      <td className="px-5 py-5 text-xs text-[#5C5550] font-bold whitespace-nowrap">
                        {row.lead_created_at ? new Date(row.lead_created_at).toLocaleDateString('es-ES') : '—'}
                      </td>
                      <td className="px-5 py-5 text-xs font-bold text-[#2C2825] font-mono whitespace-nowrap">
                        {row.phone_normalized ?? '—'}
                      </td>
                      <td className="px-5 py-5">
                        {row.match_class ? (
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-green-600/5 text-green-600 border border-green-600/20 w-fit">
                              {row.match_class}
                            </span>
                            {row.match_confidence != null && (
                              <p className="text-[9px] text-[#8E8680] font-bold tracking-widest uppercase">Conf: {Math.round(row.match_confidence * 100)}%</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#FAF7F2] text-[#8E8680] border border-border/40 w-fit">
                            Sin Cruce
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-5">
                        <p className="text-xs font-bold text-[#2C2825]">{row.patient_name ?? '—'}</p>
                        <p className="text-[10px] text-[#5C5550] font-mono mt-1">{row.patient_phone ?? '—'}</p>
                      </td>
                      <td className="px-5 py-5 text-right">
                        {row.doctoralia_net > 0 ? (
                          <div className="space-y-1">
                            <p className="text-xs font-serif font-bold text-primary tracking-tight">€{Number(row.doctoralia_net).toLocaleString('es-ES')}</p>
                            <p className="text-[9px] text-[#8E8680] font-bold uppercase tracking-wider">{row.first_settlement_at ? new Date(row.first_settlement_at).toLocaleDateString('es-ES') : ''}</p>
                          </div>
                        ) : (
                          <span className="text-[#C9B9A8] font-medium opacity-40">—</span>
                        )}
                      </td>
                      <td className="px-5 py-5 text-center">
                        {isDoctoraliaMatched(row) ? (
                          <div className="bg-green-600/5 p-1.5 rounded-xl inline-block border border-green-600/20">
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          </div>
                        ) : (
                          <div className="bg-[#FAF7F2] p-1.5 rounded-xl inline-block border border-border/40 opacity-40">
                            <XCircle className="w-4 h-4 text-[#8E8680]" />
                          </div>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
