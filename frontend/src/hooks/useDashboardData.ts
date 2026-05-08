import { useEffect, useState } from 'react'
import { invokeApi, supabase, supabaseKey, supabaseUrl } from '../lib/supabaseClient'
import type { DashboardMetrics, MetaTrendPoint } from '../types'
import {
  type CombinedMetrics,
  type RealFunnel,
  type DashboardQuality,
  EMPTY_COMBINED_METRICS,
  EMPTY_FUNNEL,
  buildDashboardPaths,
  resolveInsightsTotals,
  buildMetaFailureMessage,
  buildDashboardState
} from '../lib/dashboard-helpers'
import { logger, isProdEnv } from '../lib/utils'

const defaultTrend: MetaTrendPoint[] = []

export function useDashboardData(
  days: number,
  customFrom: string,
  customTo: string,
  campaignId: string,
  sourceFilter: string,
  campaignsCount: number,
  sourcesCount: number,
) {
  const [funnelData, setFunnelData] = useState<any[]>([])
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalLeads: 0,
    conversionRate: 0,
    activeCampaigns: 0,
    spend: 0,
    averageCpc: 0,
    metaConversions: 0,
    loading: true,
    error: null,
    metaError: null,
  })
  const [combined, setCombined] = useState<CombinedMetrics>(EMPTY_COMBINED_METRICS)
  const [funnel, setFunnel] = useState<RealFunnel | null>(null)
  const [quality, setQuality] = useState<any>(null)
  const [isFunnelDemo, setIsFunnelDemo] = useState<boolean>(false)
  const [dataMode, setDataMode] = useState<string | undefined>(undefined)
  const [trendData, setTrendData] = useState<MetaTrendPoint[]>([])
  const [sourcesList, setSourcesList] = useState<string[]>([])
  const [campaignsList, setCampaignsList] = useState<{ id: string, name: string }[]>([])

  useEffect(() => {
    let active = true
    const buildParams = () => {
      const isCustomRange = Boolean(customFrom && customTo)
      const { baseParams, campaignsPath } = buildDashboardPaths(isCustomRange, customFrom, customTo, days)
      const campaignParam = campaignId === 'ALL' ? '' : `&campaign_id=${campaignId}`
      const sourceParam = sourceFilter === 'ALL' ? '' : `&source=${sourceFilter}`
      const queryParams = `${baseParams}${campaignParam}`
      const dashboardParams = `${queryParams}${sourceParam}`
      return { queryParams, dashboardParams, campaignsPath }
    }

    const processResults = (
      metricsResult: any,
      metaTrendsResult: any,
      campaignsResult: any,
      insightsResult: any,
      funnelResult: any,
      kpisResult: any
    ) => {
      if (!active) return
      if (metricsResult.status === 'rejected') throw metricsResult.reason
      
      const kpisResponse = kpisResult.status === 'fulfilled' ? kpisResult.value : null
      const metricsData = metricsResult.value?.metrics ?? {}
      if (metricsData.bySource && Object.keys(metricsData.bySource).length > 0 && sourcesCount === 0) {
        setSourcesList(Object.keys(metricsData.bySource))
      }

      if (funnelResult.status === 'fulfilled') {
        setFunnelData(funnelResult.value.funnel || [])
      }

      const campaignsResponse = campaignsResult.status === 'fulfilled' ? campaignsResult.value : null
      const metaTrendsResponse = metaTrendsResult.status === 'fulfilled' ? metaTrendsResult.value : null
      const insightsResponse = insightsResult.status === 'fulfilled' ? insightsResult.value : null

      const metaFailureMessage = buildMetaFailureMessage(campaignsResult, insightsResult)
      const campaigns = Array.isArray(campaignsResponse?.campaigns) ? campaignsResponse.campaigns : []
      if (campaigns.length > 0 && campaignsCount === 0) {
        setCampaignsList(campaigns.map((c: any) => ({ id: c.id, name: c.name })))
      }

      const insightsSummary = insightsResponse?.summary
      const { spend, avgCpcRaw, metaConversions } = resolveInsightsTotals(insightsSummary, campaigns)
      const spendDelta = insightsResponse?.changes?.spend ?? 0

      logger.info('Dashboard', {
        totalLeads: metricsData.totalLeads,
        campaigns: campaigns.length,
        kpisSuccess: kpisResponse?.success,
        dataMode: kpisResponse?.data_quality?.overall_mode,
        metaConversions,
        hasKpis: !!kpisResponse
      })

      if (kpisResponse && kpisResponse.success !== true && !metricsData.totalLeads && !campaigns.length) {
        setIsFunnelDemo(false)
        setTrendData(defaultTrend)
        setCombined(EMPTY_COMBINED_METRICS)
        setFunnel(EMPTY_FUNNEL)
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: kpisResponse.message || 'No real KPI data available. Conecta Meta y Doctoralia para ver datos reales.',
          metaError: null,
        }))
        return
      }

      setIsFunnelDemo(
        !isProdEnv() &&
        (kpisResponse?.doctoralia?.newVerifiedPatients ?? 0) === 0,
      )
      setDataMode(kpisResponse?.data_quality?.overall_mode as string | undefined)
      setTrendData(
        Array.isArray(metaTrendsResponse?.trends)
          ? metaTrendsResponse.trends.map((item: any) => ({
              week: item.date_start ?? item.date ?? '–',
              value: Number(item.spend ?? 0),
            }))
          : [],
      )

      const { metrics: metricsPayload, combined: combinedPayload, funnel: funnelPayload, quality: qualityPayload } = buildDashboardState({
        metricsData,
        campaigns,
        insightsResponse,
        kpisResponse,
        spend,
        avgCpcRaw,
        metaConversions,
        spendDelta,
      })

      setMetrics({ ...metricsPayload, metaError: metaFailureMessage })
      setCombined(combinedPayload)
      setFunnel(funnelPayload)
      setQuality(qualityPayload)
    }

    const fetchMetrics = async () => {
      if (!supabaseUrl || !supabaseKey) {
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: 'Supabase environment variables are not configured.',
        }))
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!active) return

      if (!session?.access_token) {
        setMetrics((prev) => ({ ...prev, loading: false }))
        return
      }

      try {
        const { queryParams, dashboardParams, campaignsPath } = buildParams()
        const [metricsResult, metaTrendsResult, campaignsResult, insightsResult, funnelResult, kpisResult] = await Promise.allSettled([
          invokeApi(`/dashboard/metrics${dashboardParams}`),
          invokeApi(`/dashboard/meta-trends${queryParams}`),
          invokeApi(`/meta/campaigns${campaignsPath}`),
          invokeApi(`/meta/insights${queryParams}`),
          invokeApi('/dashboard/lead-flow'),
          invokeApi(`/kpis${dashboardParams}`),
        ])

        processResults(metricsResult, metaTrendsResult, campaignsResult, insightsResult, funnelResult, kpisResult)
      } catch (err: any) {
        if (!active) return
        logger.error('Dashboard', err)
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: err?.message || 'Unable to load dashboard metrics',
          metaError: null,
        }))
      }
    }

    fetchMetrics()
    return () => { active = false }
  }, [days, customFrom, customTo, campaignId, sourceFilter, campaignsCount, sourcesCount])

  return {
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
  }
}
