import { useState } from 'react'
import { useDashboardData } from '../hooks/useDashboardData'
import { formatDateForLabel } from '../lib/dashboard-helpers'
import { DashboardHeader } from '../components/dashboard/DashboardHeader'
import { AlertSection } from '../components/dashboard/AlertSection'
import { MetricsGrid } from '../components/dashboard/MetricsGrid'
import { FunnelAndSpendSection } from '../components/dashboard/FunnelAndSpendSection'
import { RealROISection } from '../components/dashboard/RealROISection'
import { TrendSection } from '../components/dashboard/TrendSection'
import { PatientConversionSection } from '../components/dashboard/PatientConversionSection'

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
    dataMode,
    trendData,
    sourcesList,
    campaignsList,
    quality,
  } = useDashboardData(days, customFrom, customTo, campaignId, sourceFilter, 0, 0)

  const periodLabel = customFrom && customTo
    ? `${formatDateForLabel(customFrom)} al ${formatDateForLabel(customTo)}`
    : `Últimos ${days} días`

  if (metrics.loading) {
    return (
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12 pb-24 animate-pulse">
        <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-12">
          <div className="space-y-4">
            <div className="h-16 w-64 bg-[#E5D5C5]/30 rounded-3xl" />
            <div className="h-4 w-48 bg-[#E5D5C5]/20 rounded-xl" />
          </div>
          <div className="h-14 w-48 bg-[#E5D5C5]/30 rounded-2xl" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-48 bg-white/60 rounded-[2rem] border border-[#E5D5C5]/20 shadow-sm" />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          <div className="h-[500px] bg-white/60 rounded-[2.5rem] border border-[#E5D5C5]/20 shadow-sm" />
          <div className="h-[500px] bg-white/60 rounded-[2.5rem] border border-[#E5D5C5]/20 shadow-sm" />
        </div>
      </div>
    )
  }

  return (
    <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12 pb-24" aria-labelledby="dashboard-title">
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
          <FunnelAndSpendSection funnelData={funnelData} metrics={metrics} combined={combined} periodLabel={periodLabel} quality={quality} />
          <RealROISection funnel={funnel} combined={combined} />
          <PatientConversionSection sourceFilter={sourceFilter} campaignId={campaignId} customFrom={customFrom} customTo={customTo} />
          <TrendSection trendData={trendData} formatDate={formatDateForLabel} />
        </>
      )}
    </main>
  )
}
