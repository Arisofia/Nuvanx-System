import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useDashboardData } from '../hooks/useDashboardData'
import { useCanonicalDashboardMetrics } from '../hooks/useCanonicalDashboardMetrics'
import { HubSpotMarketingContactMonitor } from '../components/dashboard/HubSpotMarketingContactMonitor'
import { AttributionHealthMonitor } from '../components/dashboard/AttributionHealthMonitor'
import { OperationsOverview } from '../components/dashboard/OperationsOverview'
import { DashboardHeader } from '../components/dashboard/DashboardHeader'
import { AlertSection } from '../components/dashboard/AlertSection'
import { MetricsGrid } from '../components/dashboard/MetricsGrid'
import { FunnelAndSpendSection } from '../components/dashboard/FunnelAndSpendSection'
import { RealROISection } from '../components/dashboard/RealROISection'
import { TrendSection } from '../components/dashboard/TrendSection'

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-8 animate-pulse" aria-label="Cargando analítica">
      <div className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div className="space-y-4">
          <div className="h-12 w-64 bg-[#E5D5C5]/30 rounded-3xl" />
          <div className="h-4 w-48 bg-[#E5D5C5]/20 rounded-xl" />
        </div>
        <div className="h-12 w-48 bg-[#E5D5C5]/30 rounded-2xl" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-40 bg-white/60 rounded-[2rem] border border-[#E5D5C5]/20 shadow-sm" />
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="h-[420px] bg-white/60 rounded-[2.5rem] border border-[#E5D5C5]/20 shadow-sm" />
        <div className="h-[420px] bg-white/60 rounded-[2.5rem] border border-[#E5D5C5]/20 shadow-sm" />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    return {
      from: toLocalDateInputValue(firstDay),
      to: toLocalDateInputValue(now)
    }
  })
  const [campaignId, setCampaignId] = useState<string>('ALL')
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')

  const {
    metrics,
    combined,
    funnel,
    dataMode,
    trendData,
    sourcesList,
    campaignsList,
    quality,
  } = useDashboardData(dateRange.from, dateRange.to, campaignId, sourceFilter, 0, 0)

  const canonical = useCanonicalDashboardMetrics(dateRange.from, dateRange.to, campaignId, sourceFilter)

  const visibleMetrics = {
    ...metrics,
    totalLeads: canonical.metrics?.totalLeads ?? null,
    conversionRate: canonical.metrics?.conversionRate ?? null,
    patientMatches: canonical.metrics?.patientMatches ?? null,
    patientConversionRate: canonical.metrics?.patientConversionRate ?? null,
    deltas: metrics.deltas
      ? {
          ...metrics.deltas,
          leads: canonical.metrics?.deltas.leads ?? null,
          patientMatches: canonical.metrics?.deltas.patientMatches ?? null,
        }
      : undefined,
    loading: metrics.loading || canonical.loading,
    error: metrics.error,
  }

  const visibleFunnelData = canonical.funnel
  const visibleFunnel = funnel
    ? {
        ...funnel,
        crmLeads: canonical.metrics?.totalLeads ?? null,
        doctoraliaPatients: canonical.metrics?.patientMatches ?? null,
        cac: null,
        cacConfidence: null,
      }
    : null

  const periodLabel = `Periodo: ${dateRange.from} al ${dateRange.to}`

  return (
    <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-14 pb-24" aria-labelledby="operations-overview-title">
      <HubSpotMarketingContactMonitor />
      <AttributionHealthMonitor />
      <OperationsOverview />

      <section className="space-y-8 border-t border-border/70 pt-10" aria-labelledby="analytics-title">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Analítica y rendimiento</p>
          <h2 id="analytics-title" className="mt-2 font-serif text-2xl font-semibold text-foreground">Profundidad del negocio</h2>
          <p className="mt-1 text-sm text-muted">Journey canónico, inversión y tendencia para análisis de gestión.</p>
        </div>

        {visibleMetrics.loading ? (
          <AnalyticsSkeleton />
        ) : (
          <>
            <DashboardHeader
              dataMode={dataMode}
              sourceFilter={sourceFilter}
              setSourceFilter={setSourceFilter}
              sourcesList={sourcesList}
              campaignId={campaignId}
              setCampaignId={setCampaignId}
              campaignsList={campaignsList}
              dateRange={dateRange}
              setDateRange={setDateRange}
              metaAccountIds={quality?.metaAccountIds || []}
            />

            <AlertSection error={visibleMetrics.error} metaError={visibleMetrics.metaError} />

            {canonical.error && (
              <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-5 py-4 flex items-start gap-3" role="status">
                <AlertTriangle className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-900">Journey canónico no disponible</p>
                  <p className="mt-1 text-sm text-amber-900/80">
                    Las métricas CRM/Doctoralia quedan ocultas para evitar usar etapas o conversiones legacy. Meta puede seguir mostrándose con sus datos de proveedor.
                  </p>
                </div>
              </div>
            )}

            {!visibleMetrics.error && (
              <>
                <MetricsGrid metrics={visibleMetrics} quality={quality} canonicalMetrics={canonical.metrics} />
                <FunnelAndSpendSection funnelData={visibleFunnelData} metrics={visibleMetrics} combined={combined} periodLabel={periodLabel} quality={quality} />
                <RealROISection funnel={visibleFunnel} combined={combined} />
                <TrendSection trendData={trendData} formatDate={(dateString) => {
                  const [year, month, day] = dateString.split('-')
                  return year && month && day ? `${day}/${month}/${year}` : dateString
                }} />
              </>
            )}
          </>
        )}
      </section>
    </main>
  )
}
