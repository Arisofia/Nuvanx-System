import { useEffect, useMemo, useState } from 'react'
import { AlertCircle } from 'lucide-react'
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
        <h1 className="text-3xl font-serif font-bold text-foreground">Lead Audit</h1>
        <p className="text-muted mt-1">Auditoría de leads con cruce Doctoralia y filtros directos al backend.</p>
      </div>

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl bg-surface p-4 border border-border">
            <p className="text-xs uppercase tracking-wide text-muted">Leads totales</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{rows.length}</p>
          </div>
          <div className="rounded-2xl bg-surface p-4 border border-border">
            <p className="text-xs uppercase tracking-wide text-muted">Leads cruzados</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{matchedCount}</p>
          </div>
          <div className="rounded-2xl bg-surface p-4 border border-border">
            <p className="text-xs uppercase tracking-wide text-muted">Rango aplicado</p>
            <p className="mt-2 text-sm text-foreground">{from || 'Inicio'} → {to || 'Fin'}</p>
          </div>
          <div className="rounded-2xl bg-surface p-4 border border-border">
            <p className="text-xs uppercase tracking-wide text-muted">Filtros activos</p>
            <p className="mt-2 text-sm text-foreground">{matchedOnly ? 'Solo cruzados' : 'Todos los leads'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-4">
          <label className="flex flex-col gap-2 text-sm">
            Campaña
            <input
              className="input-field"
              type="text"
              value={campaignName}
              onChange={(event) => setCampaignName(event.target.value)}
              placeholder="campaign_name"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Teléfono
            <input
              className="input-field"
              type="text"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="phone"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Desde
            <input
              className="input-field"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Hasta
            <input
              className="input-field"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </CardContent>
        <CardContent>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="rounded border-border text-primary focus:ring-primary"
              checked={matchedOnly}
              onChange={(event) => setMatchedOnly(event.target.checked)}
            />
            Mostrar solo leads cruzados
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resultados de Lead Audit</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted">Cargando auditoría de leads…</p>}
          {error && <ErrorState message={error} />}
          {!loading && !error && rows.length === 0 && (
            <EmptyState message="No se encontraron leads con los filtros aplicados." />
          )}
          {!loading && !error && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted">
                  <tr>
                    <th className="px-3 py-2">Lead</th>
                    <th className="px-3 py-2">Fuente</th>
                    <th className="px-3 py-2">Campaña</th>
                    <th className="px-3 py-2">Ad</th>
                    <th className="px-3 py-2">Form</th>
                    <th className="px-3 py-2">Creado</th>
                    <th className="px-3 py-2">Teléfono</th>
                    <th className="px-3 py-2">Match</th>
                    <th className="px-3 py-2">Confianza</th>
                    <th className="px-3 py-2">Paciente</th>
                    <th className="px-3 py-2">Teléfono paciente</th>
                    <th className="px-3 py-2">Liquidación</th>
                    <th className="px-3 py-2">Primer settlement</th>
                    <th className="px-3 py-2">Match tel.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.lead_id} className="border-b border-border/60 hover:bg-surface transition-colors">
                      <td className="px-3 py-2">{row.lead_name ?? '—'}</td>
                      <td className="px-3 py-2">{row.source ?? '—'}</td>
                      <td className="px-3 py-2">{row.campaign_name ?? '—'}</td>
                      <td className="px-3 py-2">{row.ad_name ?? '—'}</td>
                      <td className="px-3 py-2">{row.form_name ?? '—'}</td>
                      <td className="px-3 py-2">{row.lead_created_at ?? '—'}</td>
                      <td className="px-3 py-2">{row.phone_normalized ?? '—'}</td>
                      <td className="px-3 py-2">{row.match_class ?? '—'}</td>
                      <td className="px-3 py-2">{row.match_confidence ?? '—'}</td>
                      <td className="px-3 py-2">{row.patient_name ?? '—'}</td>
                      <td className="px-3 py-2">{row.patient_phone ?? '—'}</td>
                      <td className="px-3 py-2">{row.settlement_date ?? '—'}</td>
                      <td className="px-3 py-2">{row.first_settlement_at ?? '—'}</td>
                      <td className="px-3 py-2">{row.phoneCrossMatch ? 'Sí' : 'No'}</td>
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
