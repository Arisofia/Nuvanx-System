import { useEffect, useState } from 'react'
import { invokeApi, supabase, supabaseKey, supabaseUrl } from '../lib/supabaseClient'
import type { DashboardMetrics, MetaTrendPoint } from '../types'
import {
  type CombinedMetrics,
  type RealFunnel,
  EMPTY_COMBINED_METRICS,
  EMPTY_FUNNEL,
  buildDashboardPaths,
  resolveInsightsTotals,
  buildMetaFailureMessage,
  buildDashboardState
} from '../lib/dashboard-helpers'
import {
  DASHBOARD_CACHE_TTL_MS,
  DASHBOARD_REQUEST_RETRIES,
  DASHBOARD_REQUEST_TIMEOUT_MS,
  buildDashboardCacheKey,
  getUserFacingDashboardError,
  isCacheEntryFresh,
  validateDashboardBundle,
} from '../lib/dashboard-validation'
import { logger, isProdEnv } from '../lib/utils'

const defaultTrend: MetaTrendPoint[] = []

type DashboardCacheEntry<T> = {
  createdAt: number
  promise?: Promise<T>
  value?: T
}

const dashboardRequestCache = new Map<string, DashboardCacheEntry<any>>()

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => { if (timeout) clearTimeout(timeout) })
}

async function invokeDashboardResource<T>(path: string, retries = DASHBOARD_REQUEST_RETRIES): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(invokeApi(path), DASHBOARD_REQUEST_TIMEOUT_MS, path) as T
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
      }
    }
  }
  throw lastError
}

function getCachedDashboardResource<T>(path: string, cacheNamespace: string): Promise<T> {
  const key = `${cacheNamespace}:${buildDashboardCacheKey(path)}`
  const cached = dashboardRequestCache.get(key)
  if (cached?.value !== undefined && isCacheEntryFresh(cached.createdAt, DASHBOARD_CACHE_TTL_MS)) {
    return Promise.resolve(cached.value as T)
  }
  if (cached?.promise && isCacheEntryFresh(cached.createdAt, DASHBOARD_CACHE_TTL_MS)) {
    return cached.promise as Promise<T>
  }

  const promise = invokeDashboardResource<T>(path)
    .then((value) => {
      dashboardRequestCache.set(key, { createdAt: Date.now(), value })
      return value
    })
    .catch((error) => {
      dashboardRequestCache.delete(key)
      throw error
    })

  dashboardRequestCache.set(key, { createdAt: Date.now(), promise })
  return promise
}

export function clearDashboardDataCache() {
  dashboardRequestCache.clear()
}

export function useDashboardData(
  days: number,
  customFrom: string,
  customTo: string,
  campaignId: string,
  sourceFilter: string,
  campaignsCount: number,
  sourcesCount: number,
) {
  const [funnelData, setFunnelData] = useState<Array<Record<string, unknown>>>([])
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
  const [trendData, setTrendData] = useState(defaultTrend)
  const [sourcesList, setSourcesList] = useState<string[]>([])
  const [campaignsList, setCampaignsList] = useState<{ id: string, name: string }[]>([])

  useEffect(() => {
    let active = true
    const buildParams = () => {
      const isCustomRange = Boolean(customFrom && customTo)
      const { baseParams, campaignsPath } = buildDashboardPaths(isCustomRange, customFrom, customTo, days)
      const campaignParam = campaignId === 'ALL' ? '' : `&campaign_id=${encodeURIComponent(campaignId)}`
      const sourceParam = sourceFilter === 'ALL' ? '' : `&source=${encodeURIComponent(sourceFilter)}`
      const queryParams = `${baseParams}${campaignParam}`
      const dashboardParams = `${queryParams}${sourceParam}`
      return { queryParams, dashboardParams, campaignsPath }
    }

    const processResults = (
      metricsResult: PromiseSettledResult<any>,
      metaTrendsResult: PromiseSettledResult<any>,
      campaignsResult: PromiseSettledResult<any>,
      insightsResult: PromiseSettledResult<any>,
      funnelResult: PromiseSettledResult<any>,
      kpisResult: PromiseSettledResult<any>
    ) => {
      if (!active) return
      if (metricsResult.status === 'rejected') throw metricsResult.reason

      const kpisResponse = kpisResult.status === 'fulfilled' ? kpisResult.value : null
      const campaignsResponse = campaignsResult.status === 'fulfilled' ? campaignsResult.value : null
      const metaTrendsResponse = metaTrendsResult.status === 'fulfilled' ? metaTrendsResult.value : null
      const insightsResponse = insightsResult.status === 'fulfilled' ? insightsResult.value : null
      const funnelResponse = funnelResult.status === 'fulfilled' ? funnelResult.value : null

      const validation = validateDashboardBundle({
        metricsResponse: metricsResult.value,
        campaignsResponse,
        metaTrendsResponse,
        funnelResponse,
        kpisResponse,
      })

      if (!validation.valid) {
        logger.warn('Dashboard validation', validation.errors)
      }

      const { metricsData, campaigns, trendData: safeTrendData, funnelRows } = validation.data
      const bySource = metricsData.bySource && typeof metricsData.bySource === 'object' && !Array.isArray(metricsData.bySource)
        ? metricsData.bySource as Record<string, unknown>
        : {}
      if (Object.keys(bySource).length > 0 && sourcesCount === 0) {
        setSourcesList(Object.keys(bySource))
      }

      setFunnelData(funnelRows)

      const metaFailureMessage = buildMetaFailureMessage(campaignsResult, insightsResult)
      if (campaigns.length > 0 && campaignsCount === 0) {
        setCampaignsList(campaigns.map((campaign) => ({
          id: String(campaign.id ?? ''),
          name: String(campaign.name ?? 'Campaña sin nombre'),
        })).filter((campaign) => campaign.id))
      }

      const insightsSummary = insightsResponse?.summary
      const { spend, avgCpcRaw, metaConversions } = resolveInsightsTotals(insightsSummary, campaigns)
      const spendDelta = insightsResponse?.changes?.spend ?? null

      logger.info('Dashboard', {
        totalLeads: metricsData.totalLeads,
        campaigns: campaigns.length,
        kpisSuccess: kpisResponse?.success,
        dataMode: kpisResponse?.data_quality?.overall_mode,
        metaConversions,
        hasKpis: Boolean(kpisResponse),
        validationErrors: validation.errors.length,
      })

      if (kpisResponse && kpisResponse.success !== true && !metricsData.totalLeads && !campaigns.length) {
        setIsFunnelDemo(false)
        setTrendData(defaultTrend)
        setCombined(EMPTY_COMBINED_METRICS)
        setFunnel(EMPTY_FUNNEL)
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: kpisResponse.message || 'No hay KPIs reales disponibles. Conecta Meta y Doctoralia para ver datos reales.',
          metaError: null,
        }))
        return
      }

      setIsFunnelDemo(
        !isProdEnv() &&
        (kpisResponse?.doctoralia?.newVerifiedPatients ?? 0) === 0,
      )
      setDataMode(kpisResponse?.data_quality?.overall_mode as string | undefined)
      setTrendData(safeTrendData)

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
      setMetrics((prev) => ({ ...prev, loading: true, error: null }))

      if (!supabaseUrl || !supabaseKey) {
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: 'Faltan variables de entorno de Supabase. Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.',
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
        const cacheNamespace = session.user?.id ?? 'anonymous'
        const [metricsResult, metaTrendsResult, campaignsResult, insightsResult, funnelResult, kpisResult] = await Promise.allSettled([
          getCachedDashboardResource(`/dashboard/metrics${dashboardParams}`, cacheNamespace),
          getCachedDashboardResource(`/dashboard/meta-trends${queryParams}`, cacheNamespace),
          getCachedDashboardResource(`/meta/campaigns${campaignsPath}`, cacheNamespace),
          getCachedDashboardResource(`/meta/insights${queryParams}`, cacheNamespace),
          getCachedDashboardResource('/dashboard/lead-flow', cacheNamespace),
          getCachedDashboardResource(`/kpis${dashboardParams}`, cacheNamespace),
        ])

        processResults(metricsResult, metaTrendsResult, campaignsResult, insightsResult, funnelResult, kpisResult)
      } catch (err: any) {
        if (!active) return
        logger.error('Dashboard', err)
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: getUserFacingDashboardError(err),
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
