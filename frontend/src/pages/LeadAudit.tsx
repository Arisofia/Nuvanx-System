import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { invokeApi } from '../lib/supabaseClient'
import { GitMerge, Search, Filter } from 'lucide-react'

interface LeadAuditRow {
  lead_id: string
  lead_name: string | null
  source: string | null
  campaign_name: string | null
  ad_name: string | null
  form_name: string | null
  lead_created_at: string | null
  phone_normalized: string | null
  patient_id: string | null
  patient_name: string | null
  patient_dni: string | null
  patient_phone: string | null
  match_confidence: number | null
  match_class: string | null
  settlement_date: string | null
  first_settlement_at: string | null
  phoneCrossMatch: boolean
}

export default function LeadAudit() {
  const [rows, setRows] = useState<LeadAuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [matchedOnly, setMatchedOnly] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [campaignName, setCampaignName] = useState('')
  const [phone, setPhone] = useState('')

  useEffect(() => {
    let isActive = true
    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams()
        params.set('limit', '500')
        if (matchedOnly) params.set('matched', 'true')
        if (from) params.set('from', from)
        if (to) params.set('to', to)
        if (campaignName) params.set('campaign_name', campaignName)
        if (phone) params.set('phone', phone)

        const result: any = await invokeApi(`/reports/lead-audit?${params.toString()}`)
        if (!isActive) return
        setRows(result?.leads ?? [])
        setTotal(result?.total ?? 0)
      } catch (err: any) {
        if (!isActive) return
        setError(err?.message ?? 'Error cargando auditoría de leads.')
      } finally {
        if (!isActive) return
        setLoading(false)
      }
    }

    load()
    return () => {
      isActive = false
    }
  }, [matchedOnly, from, to, campaignName, phone])

  const matchedCount = useMemo(
    () => rows.filter((row) => row.patient_id || row.match_class || row.patient_name).length,
    [rows],
  )

  const summary = [
    { label: 'Leads totales', value: total },
    { label: 'Leads cruzados', value: matchedCount },
    { label: 'Rango', value: from && to ? `${from} → ${to}` : 'Últimos datos' },
    { label: 'Filtrado', value: matchedOnly ? 'Solo cruzados' : 'Todos' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1 text-sm text-muted">
            <GitMerge className="w-4 h-4" /> Lead Audit
          </div>
          <h1 className="mt-4 text-3xl font-serif font-bold text-foreground">Auditoría de leads</h1>
          <p className="text-muted mt-1 max-w-2xl">Revisa cada lead con trazabilidad de campaña, cruce Doctoralia y fechas de liquidación.</p>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 lg:grid-cols-4">
          {summary.map((item) => (
            <div key={item.label} className="rounded-2xl bg-surface p-4 border border-border">
              <p className="text-xs uppercase tracking-wide text-muted">{item.label}</p>
              <p className="mt-2 text-xl font-semibold text-foreground">{item.value ?? '—'}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Filtros de auditoría</CardTitle>
            <p className="text-sm text-muted">Filtra por campaña, teléfono, fecha y cruces Doctoralia.</p>
          </div>
          <Button
            variant={matchedOnly ? 'secondary' : 'outline'}
            onClick={() => setMatchedOnly((current) => !current)}
            className="gap-2"
          >
            <Filter className="w-4 h-4" />
            {matchedOnly ? 'Mostrando solo cruzados' : 'Mostrar todos los leads'}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-4">
          <label className="flex flex-col gap-2 text-sm">
            Campaña
            <Input
              placeholder="Nombre de campaña"
              value={campaignName}
              onChange={(event) => setCampaignName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Teléfono
            <Input
              placeholder="Teléfono normalizado"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Desde
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Hasta
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resultados de auditoría</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted">Cargando datos...</p>}
          {error && <p className="text-sm text-[#D9534F]">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-muted">No se encontraron leads con los filtros aplicados.</p>
          )}
          {!loading && !error && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted">
                  <tr>
                    <th className="px-3 py-3">Lead</th>
                    <th className="px-3 py-3">Fuente / Campaña</th>
                    <th className="px-3 py-3">Teléfono</th>
                    <th className="px-3 py-3">Paciente</th>
                    <th className="px-3 py-3">Match</th>
                    <th className="px-3 py-3">Liquidación</th>
                    <th className="px-3 py-3">First settlement</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.lead_id} className="border-b border-border/70 hover:bg-surface transition-colors">
                      <td className="px-3 py-3">
                        <div className="font-medium text-foreground">{row.lead_name ?? '—'}</div>
                        <div className="text-xs text-muted">{row.lead_created_at ?? '—'}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div>{row.source ?? '—'}</div>
                        <div className="text-xs text-muted">{row.campaign_name ?? '—'}</div>
                        <div className="text-xs text-muted">{row.ad_name ?? '—'}</div>
                      </td>
                      <td className="px-3 py-3">{row.phone_normalized ?? '—'}</td>
                      <td className="px-3 py-3">
                        <div>{row.patient_name ?? row.patient_id ?? '—'}</div>
                        <div className="text-xs text-muted">{row.patient_dni ?? row.patient_phone ?? '—'}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div>{row.match_class ?? '—'}</div>
                        <div className="text-xs text-muted">{row.match_confidence ?? '—'}</div>
                      </td>
                      <td className="px-3 py-3">{row.settlement_date ?? '—'}</td>
                      <td className="px-3 py-3">{row.first_settlement_at ?? '—'}</td>
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
