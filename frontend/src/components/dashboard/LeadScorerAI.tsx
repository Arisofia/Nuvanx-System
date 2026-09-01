import { useCallback, useEffect, useState } from 'react'
import { Brain, RefreshCcw, Zap, Users } from 'lucide-react'
import { Card, CardContent } from '../ui/card'

type LeadScore = {
  id: string
  name: string
  email: string
  tier: 'HOT' | 'WARM' | 'COLD'
  finalScore: number
  sendToMeta: boolean
  reasons: string[]
  quality_label: string
  recommended_action: string
  meta_capi_priority: string
}

type LeadScorerStats = {
  total: number
  hot: number
  warm: number
  metaReady: number
}

export function LeadScorerAI() {
  const [leads, setLeads] = useState<LeadScore[]>([])
  const [stats, setStats] = useState<LeadScorerStats>({ total: 0, hot: 0, warm: 0, metaReady: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // URL del Cloudflare Worker - configurar en environment variable
      const workerUrl = import.meta.env.VITE_CLOUDFLARE_LEAD_SCORER_URL || 'https://lead-scorer.nuvanx.workers.dev'
      const response = await fetch(`${workerUrl}/api/leads`)
      
      if (!response.ok) {
        throw new Error(`Error del Cloudflare Worker: ${response.status}`)
      }
      
      const data = await response.json()
      const processedLeads = data.slice(0, 10).map((lead: any) => ({
        id: lead.id,
        name: lead.name || '(sin nombre)',
        email: lead.email || '',
        tier: lead.tier || 'COLD',
        finalScore: lead.score || 0,
        sendToMeta: lead.sendToMeta || false,
        reasons: lead.reasons || [],
        quality_label: lead.quality_label || 'Media',
        recommended_action: lead.recommended_action || 'Sin acción',
        meta_capi_priority: lead.meta_capi_priority || 'Baja prioridad'
      }))
      
      setLeads(processedLeads)
      setStats({
        total: processedLeads.length,
        hot: processedLeads.filter((l: LeadScore) => l.tier === 'HOT').length,
        warm: processedLeads.filter((l: LeadScore) => l.tier === 'WARM').length,
        metaReady: processedLeads.filter((l: LeadScore) => l.sendToMeta).length
      })
    } catch (err: any) {
      setError(err?.message || 'No se pudo cargar los leads scored por IA')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = globalThis.setInterval(() => void load(), 300_000) // Actualizar cada 5 minutos
    return () => globalThis.clearInterval(timer)
  }, [load])

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'HOT': return 'text-rose-600 bg-rose-50 border-rose-200'
      case 'WARM': return 'text-amber-600 bg-amber-50 border-amber-200'
      default: return 'text-slate-600 bg-slate-50 border-slate-200'
    }
  }

  const getTierBadge = (tier: string) => {
    switch (tier) {
      case 'HOT': return 'bg-rose-500 text-white'
      case 'WARM': return 'bg-amber-500 text-white'
      default: return 'bg-slate-500 text-white'
    }
  }

  return (
    <Card className="overflow-hidden border border-border/70 bg-card" data-testid="lead-scorer-ai">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-xl border border-border/70 bg-primary/10 p-2.5 text-primary">
              <Brain className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Lead Scorer AI</p>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                  <Zap className="h-3 w-3" />
                  Llama-4-Scout
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                Scoring de leads HubSpot con IA · Cloudflare Workers AI
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Analizados</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                {loading ? '—' : error ? 'Error' : stats.total}
              </p>
            </div>
            {!loading && !error && stats.total > 0 && (
              <>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">HOT</p>
                  <p className="mt-1 text-lg font-semibold text-rose-600">{stats.hot}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">WARM</p>
                  <p className="mt-1 text-lg font-semibold text-amber-600">{stats.warm}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">→ Meta CAPI</p>
                  <p className="mt-1 text-lg font-semibold text-blue-600">{stats.metaReady}</p>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-[11px] font-semibold text-foreground transition hover:border-primary/40 disabled:opacity-50"
              aria-label="Actualizar leads scored por IA"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-xs text-rose-700">
            <Users className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && leads.length > 0 && (
          <div className="mt-4 space-y-2">
            {leads.slice(0, 5).map((lead) => (
              <div key={lead.id} className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{lead.name}</p>
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold ${getTierBadge(lead.tier)}`}>
                      {lead.tier}
                    </span>
                    {lead.sendToMeta && (
                      <span className="inline-flex items-center rounded bg-blue-500 px-2 py-0.5 text-[10px] font-bold text-white">
                        → Meta
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted">{lead.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-foreground">{lead.finalScore}</p>
                  <p className="text-[10px] text-muted">{lead.quality_label}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}