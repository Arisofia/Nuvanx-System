import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { supabase } from '../../lib/supabaseClient'

type MonthlyRow = {
  month_key: string
  source: string | null
  campaign_id: string | null
  campaign_name: string | null
  scheduled_valuation_rows: number | string | null
  scheduled_valuations: number | string | null
  real_patient_rows: number | string | null
  real_patients: number | string | null
  verified_revenue: number | string | null
  valuation_to_patient_rate_pct: number | string | null
}

type DetailRow = {
  lead_id: string
  month_key: string
  appointment_date: string | null
  source: string | null
  campaign_id: string | null
  campaign_name: string | null
  lead_name: string | null
  treatment_name: string | null
  verified_revenue: number | string | null
  doctoralia_revenue: number | string | null
  matched_procedure_rows: number | string | null
  last_procedure_at: string | null
  is_real_patient: boolean | null
  patient_rule: string | null
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

function ruleLabel(rule: string | null | undefined) {
  if (rule === 'crm_verified_revenue') return 'Revenue CRM'
  if (rule === 'doctoralia_paid_procedure') return 'Procedimiento Doctoralia'
  return 'Solo valoración'
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
  const [patientFilter, setPatientFilter] = useState('ALL')
  const [nameSearch, setNameSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError(null)

      let monthlyQuery = supabase
        .from('v_patient_conversion_monthly')
        .select('*')
        .order('month_key', { ascending: false })

      let detailQuery = supabase
        .from('v_patient_conversion_detail')
        .select('*')
        .order('appointment_date', { ascending: false })
        .limit(500)

      if (sourceFilter !== 'ALL') {
        monthlyQuery = monthlyQuery.eq('source', sourceFilter)
        detailQuery = detailQuery.eq('source', sourceFilter)
      }
      if (campaignId !== 'ALL') {
        monthlyQuery = monthlyQuery.eq('campaign_id', campaignId)
        detailQuery = detailQuery.eq('campaign_id', campaignId)
      }
      if (customFrom) {
        detailQuery = detailQuery.gte('appointment_date', customFrom)
      }
      if (customTo) {
        detailQuery = detailQuery.lte('appointment_date', `${customTo}T23:59:59`)
      }

      const [monthlyResult, detailResult] = await Promise.all([monthlyQuery, detailQuery])
      if (!active) return

      if (monthlyResult.error || detailResult.error) {
        setError(monthlyResult.error?.message || detailResult.error?.message || 'No se pudo cargar pacientes nuevos')
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
      if (patientFilter === 'REAL' && !row.is_real_patient) return false
      if (patientFilter === 'PENDING' && row.is_real_patient) return false
      if (search && !String(row.lead_name ?? '').toLowerCase().includes(search)) return false
      return true
    })
  }, [detail, monthFilter, patientFilter, nameSearch])

  const totals = useMemo(() => monthly.reduce((acc, row) => ({
    scheduled: acc.scheduled + toNumber(row.scheduled_valuations),
    real: acc.real + toNumber(row.real_patients),
    revenue: acc.revenue + toNumber(row.verified_revenue),
  }), { scheduled: 0, real: 0, revenue: 0 }), [monthly])

  if (loading) {
    return <Card className="border-none rounded-[2.5rem] bg-white/70 p-8 text-[#8E8680]">Cargando pacientes nuevos...</Card>
  }

  return (
    <Card className="border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] overflow-hidden bg-white/80 backdrop-blur-md rounded-[2.5rem]">
      <CardHeader className="border-b border-[#E5D5C5]/20 px-8 pt-8 pb-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <CardTitle className="font-serif text-3xl text-[#2C2825]">Pacientes nuevos únicos</CardTitle>
            <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[#8E8680] font-bold">
              Valoración agendada → procedimiento real / control clínico
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4">
              <div className="text-2xl font-serif font-bold text-[#2C2825]">{totals.scheduled}</div>
              <div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">valoraciones</div>
            </div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4">
              <div className="text-2xl font-serif font-bold text-[#2C2825]">{totals.real}</div>
              <div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">pacientes</div>
            </div>
            <div className="bg-[#FAF7F2] rounded-2xl px-5 py-4">
              <div className="text-2xl font-serif font-bold text-[#2C2825]">{formatMoney(totals.revenue)}</div>
              <div className="text-[9px] uppercase tracking-widest text-[#8E8680] font-bold">revenue CRM</div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-8 space-y-8">
        {error && <div className="rounded-2xl bg-red-50 text-red-700 p-4 text-sm">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} className="rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white">
            <option value="ALL">Todos los meses</option>
            {months.map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
          <select value={patientFilter} onChange={(event) => setPatientFilter(event.target.value)} className="rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white">
            <option value="ALL">Todos</option>
            <option value="REAL">Pacientes reales</option>
            <option value="PENDING">Solo valoración</option>
          </select>
          <input value={nameSearch} onChange={(event) => setNameSearch(event.target.value)} placeholder="Buscar por nombre" className="md:col-span-3 rounded-2xl border border-[#E5D5C5] px-4 py-3 text-sm bg-white" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.18em] text-[#8E8680] border-b border-[#E5D5C5]/50">
                <th className="py-3 pr-4">Mes</th>
                <th className="py-3 pr-4">Valoraciones únicas</th>
                <th className="py-3 pr-4">Pacientes reales únicos</th>
                <th className="py-3 pr-4">Conversión</th>
                <th className="py-3 pr-4">Revenue</th>
                <th className="py-3 pr-4">Campaña</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((row) => (
                <tr key={`${row.month_key}-${row.source}-${row.campaign_id}`} className="border-b border-[#E5D5C5]/20">
                  <td className="py-4 pr-4 font-bold text-[#2C2825]">{row.month_key}</td>
                  <td className="py-4 pr-4">{toNumber(row.scheduled_valuations)}</td>
                  <td className="py-4 pr-4">{toNumber(row.real_patients)}</td>
                  <td className="py-4 pr-4">{toNumber(row.valuation_to_patient_rate_pct).toLocaleString('es-ES')}%</td>
                  <td className="py-4 pr-4">{formatMoney(row.verified_revenue)}</td>
                  <td className="py-4 pr-4 text-[#8E8680]">{row.campaign_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.18em] text-[#8E8680] border-b border-[#E5D5C5]/50">
                <th className="py-3 pr-4">Nombre</th>
                <th className="py-3 pr-4">Fecha valoración</th>
                <th className="py-3 pr-4">Campaña</th>
                <th className="py-3 pr-4">Estado</th>
                <th className="py-3 pr-4">Regla</th>
                <th className="py-3 pr-4">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {visibleDetail.map((row) => (
                <tr key={row.lead_id} className="border-b border-[#E5D5C5]/20">
                  <td className="py-3 pr-4 font-bold text-[#2C2825]">{row.lead_name || 'Sin nombre'}</td>
                  <td className="py-3 pr-4">{formatDate(row.appointment_date)}</td>
                  <td className="py-3 pr-4 text-[#8E8680]">{row.campaign_name || '—'}</td>
                  <td className="py-3 pr-4">{row.is_real_patient ? 'Paciente real' : 'Solo valoración'}</td>
                  <td className="py-3 pr-4">{ruleLabel(row.patient_rule)}</td>
                  <td className="py-3 pr-4">{formatMoney(toNumber(row.verified_revenue) || toNumber(row.doctoralia_revenue))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
