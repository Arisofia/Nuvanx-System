import { useState } from 'react'
import { useDashboardData } from '../hooks/useDashboardData'
import { formatDateForLabel } from '../lib/dashboard-helpers'
import { DashboardHeader } from '../components/dashboard/DashboardHeader'
import { AlertSection } from '../components/dashboard/AlertSection'
import { MetricsGrid } from '../components/dashboard/MetricsGrid'
import { FunnelAndSpendSection } from '../components/dashboard/FunnelAndSpendSection'
import { RealROISection } from '../components/dashboard/RealROISection'
import { TrendSection } from '../components/dashboard/TrendSection'

export default function Dashboard() {
  const [days, setDays] = useState<7 | 14 | 30 | 90>(30)
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [campaignId, setCampaignId] = useState<string>('ALL')
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')

  const {
    metrics,
    combined,
    funnel,
    funnelData,
    isFunnelDemo,
    dataMode,
    trendData,
    sourcesList,
    campaignsList,
    quality,
  } = useDashboardData(
    days,
    customFrom,
    customTo,
    campaignId,
    sourceFilter,
    0, // Will be updated by hook internally if counts are 0
    0,
  )

  const periodLabel = customFrom && customTo
    ? `${formatDateForLabel(customFrom)} al ${formatDateForLabel(customTo)}`
    : `Últimos ${days} días`

  if (metrics.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          <p className="text-sm font-bold text-[#8E8680] uppercase tracking-widest animate-pulse">
            Sincronizando Nuvanx...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12 pb-24">
      <DashboardHeader
        dataMode={dataMode}
        sourceFilter={sourceFilter}
        setSourceFilter={setSourceFilter}
        sourcesList={sourcesList}
        campaignId={campaignId}
        setCampaignId={setCampaignId}
        campaignsList={campaignsList}
        days={days}
        setDays={setDays}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        metaAccountIds={quality?.metaAccountIds || []}
      />

      <AlertSection error={metrics.error} metaError={metrics.metaError} />

      {!metrics.error && (
        <>
          <MetricsGrid metrics={metrics} quality={quality} />

          <FunnelAndSpendSection
            funnelData={funnelData}
            metrics={metrics}
            combined={combined}
            periodLabel={periodLabel}
            quality={quality}
          />

          <RealROISection
            funnel={funnel}
            combined={combined}
            isFunnelDemo={isFunnelDemo}
          />

          <TrendSection trendData={trendData} formatDate={formatDateForLabel} />
        </>
      )}
    </div>
  )
}
