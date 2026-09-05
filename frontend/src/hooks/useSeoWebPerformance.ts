import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export type SeoWebPerformanceRow = {
  run_id: string
  url: string
  device: 'mobile' | 'desktop'
  source: string
  performance_score: number | null
  lcp_ms: number | null
  cls: number | null
  inp_ms: number | null
  quality_status: 'ok' | 'partial' | 'unavailable'
  error_code: string | null
  error_message: string | null
  captured_at: string
}

export type SeoWebPerformanceState = 'loading' | 'fresh' | 'stale' | 'unavailable'

const STALE_AFTER_MS = 48 * 60 * 60 * 1000

function cellKey(row: Pick<SeoWebPerformanceRow, 'url' | 'device'>) {
  return `${row.url}::${row.device}`
}

export function useSeoWebPerformance() {
  const [rows, setRows] = useState<SeoWebPerformanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data, error: queryError } = await supabase
        .from('seo_web_performance')
        .select('run_id,url,device,source,performance_score,lcp_ms,cls,inp_ms,quality_status,error_code,error_message,captured_at')
        .order('captured_at', { ascending: false })
        .limit(100)

      if (cancelled) return
      if (queryError) {
        setRows([])
        setError(queryError.message)
        setLoading(false)
        return
      }

      const latest = new Map<string, SeoWebPerformanceRow>()
      for (const row of (data ?? []) as SeoWebPerformanceRow[]) {
        const key = cellKey(row)
        if (!latest.has(key)) latest.set(key, row)
      }

      setRows(Array.from(latest.values()).sort((a, b) => a.url.localeCompare(b.url) || a.device.localeCompare(b.device)))
      setError(null)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const state = useMemo<SeoWebPerformanceState>(() => {
    if (loading) return 'loading'
    if (error || rows.length === 0) return 'unavailable'

    const usableRows = rows.filter((row) => row.quality_status !== 'unavailable')
    if (usableRows.length === 0) return 'unavailable'

    const newestCapture = Math.max(...usableRows.map((row) => new Date(row.captured_at).getTime()).filter(Number.isFinite))
    if (!Number.isFinite(newestCapture)) return 'unavailable'
    return Date.now() - newestCapture > STALE_AFTER_MS ? 'stale' : 'fresh'
  }, [error, loading, rows])

  return { rows, loading, error, state }
}
