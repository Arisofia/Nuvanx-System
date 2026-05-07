import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Search, Activity, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { invokeApi } from '../lib/supabaseClient'

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
    () => rows.filter((row) => row.patient_id != null).length,
    [rows],
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-serif font-bold text-foreground tracking-tight">Lead Audit</h1>
        <p className="text-muted text-lg mt-2 font-medium">Auditoría detallada de trazabilidad entre Meta y Doctoralia</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Leads Totales</p>
            <p className="text-3xl font-bold mt-2 tracking-tight">{rows.length}</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Leads Cruzados</p>
            <div className="flex items-center gap-2 mt-2">
              <p className="text-3xl font-bold tracking-tight text-green-500">{matchedCount}</p>
              <CheckCircle2 className="h-5 w-5 text-green-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Rango Temporal</p>
            <p className="text-sm font-bold mt-3 text-foreground bg-surface px-2 py-1 rounded-md border border-border inline-block tracking-tight">
              {from || 'Inicio'} <span className="text-muted mx-1">→</span> {to || 'Fin'}
            </p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Estado Filtros</p>
            <div className={`mt-3 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border w-fit ${matchedOnly ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-muted/10 text-muted border-muted/20'}`}>
              {matchedOnly ? 'Solo Cruzados' : 'Sin Restricción'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-border/50 pb-6">
          <CardTitle className="font-serif text-xl flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            Filtros de Auditoría
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <label htmlFor="lead-audit-campaign-name" className="text-xs font-bold text-muted uppercase tracking-wider">Campaña</label>
            <input
              id="lead-audit-campaign-name"
              className="w-full px-4 py-2 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted/50"
              type="text"
              value={campaignName}
              onChange={(event) => setCampaignName(event.target.value)}
              placeholder="Nombre de campaña…"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="lead-audit-phone" className="text-xs font-bold text-muted uppercase tracking-wider">Teléfono</label>
            <input
              id="lead-audit-phone"
              className="w-full px-4 py-2 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted/50"
              type="text"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Número de teléfono…"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="lead-audit-from" className="text-xs font-bold text-muted uppercase tracking-wider">Fecha Desde</label>
            <input
              id="lead-audit-from"
              className="w-full px-4 py-2 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="lead-audit-to" className="text-xs font-bold text-muted uppercase tracking-wider">Fecha Hasta</label>
            <input
              id="lead-audit-to"
              className="w-full px-4 py-2 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </CardContent>
        <CardContent className="pt-0 pb-6">
          <label className="inline-flex items-center gap-3 bg-surface/50 px-4 py-2 rounded-xl border border-border cursor-pointer hover:bg-surface transition-colors">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-background transition-all"
              checked={matchedOnly}
              onChange={(event) => setMatchedOnly(event.target.checked)}
            />
            <span className="text-sm font-bold text-foreground">Mostrar solo leads cruzados con Doctoralia</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border/50 pb-6">
          <CardTitle className="font-serif text-xl flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Resultados Detallados
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {loading && (
            <div className="py-20 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-muted font-bold uppercase tracking-widest">Analizando registros…</p>
            </div>
          )}
          {error && <ErrorState message={error} />}
          {!loading && !error && rows.length === 0 && (
            <EmptyState message="No se encontraron leads con los filtros aplicados." />
          )}
          {!loading && !error && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border text-[10px] font-bold text-muted uppercase tracking-wider">
                    <th className="px-4 py-3">Lead / Fuente</th>
                    <th className="px-4 py-3">Campaña / Form</th>
                    <th className="px-4 py-3">Fecha Lead</th>
                    <th className="px-4 py-3">Teléfono Lead</th>
                    <th className="px-4 py-3">Cruce / Confianza</th>
                    <th className="px-4 py-3">Paciente / Tel.</th>
                    <th className="px-4 py-3">Settlement / Fecha</th>
                    <th className="px-4 py-3 text-center">Cross-Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {rows.map((row) => (
                    <tr key={row.lead_id} className="group hover:bg-surface transition-colors">
                      <td className="px-4 py-4">
                        <p className="font-bold text-foreground text-sm">{row.lead_name ?? '—'}</p>
                        <p className="text-[10px] font-bold text-primary uppercase mt-1">{row.source ?? '—'}</p>
                      </td>
                      <td className="px-4 py-4 max-w-[200px]">
                        <p className="text-xs font-medium text-foreground truncate" title={row.campaign_name}>{row.campaign_name ?? '—'}</p>
                        <p className="text-[10px] text-muted font-medium mt-1 truncate" title={row.form_name}>{row.form_name ?? '—'}</p>
                      </td>
                      <td className="px-4 py-4 text-xs font-medium text-muted">
                        {row.lead_created_at ? new Date(row.lead_created_at).toLocaleDateString('es-ES') : '—'}
                      </td>
                      <td className="px-4 py-4 text-xs font-bold text-foreground font-mono">
                        {row.phone_normalized ?? '—'}
                      </td>
                      <td className="px-4 py-4">
                        {row.match_class ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 w-fit">
                              {row.match_class}
                            </span>
                            {row.match_confidence != null && (
                              <p className="text-[10px] text-muted font-bold tracking-tighter">Conf: {Math.round(row.match_confidence * 100)}%</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted/10 text-muted border border-muted/20 w-fit">
                            Sin Cruce
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-xs font-bold text-foreground">{row.patient_name ?? '—'}</p>
                        <p className="text-[10px] text-muted font-mono mt-1">{row.patient_phone ?? '—'}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-xs font-bold text-primary">{row.settlement_date ? `€${row.doctoralia_net?.toLocaleString('es-ES') ?? '—'}` : '—'}</p>
                        <p className="text-[10px] text-muted font-medium mt-1">
                          {row.first_settlement_at ? new Date(row.first_settlement_at).toLocaleDateString('es-ES') : '—'}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-center">
                        {row.phoneCrossMatch ? (
                          <div className="bg-green-500/10 p-1.5 rounded-lg inline-block border border-green-500/20">
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          </div>
                        ) : (
                          <div className="bg-muted/10 p-1.5 rounded-lg inline-block border border-muted/20">
                            <XCircle className="w-4 h-4 text-muted/40" />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
