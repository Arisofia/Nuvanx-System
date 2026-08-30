import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useLeads, hasVerifiedAppointmentEvidence } from '../hooks/useLeads'
import { KanbanBoard } from '../components/crm/KanbanBoard'
import { LeadDetailSheet } from '../components/crm/LeadDetailSheet'
import type { Lead, LeadStage } from '../types'
import { MetaAccountsInline } from '../components/MetaAccountsNotice'

const ALL_STAGES = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'] as const
const STALE_LEADS_AFTER_DAYS = 7
const CRM_LOADED_AT_MS = Date.now()

export default function CRM() {
  const { leads, loading, error, orphanCount, updateLead, deleteLead } = useLeads()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [stageFilter, setStageFilter] = useState<string>('ALL')
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')

  const sources = useMemo(() => {
    const s = new Set(leads.map((l) => l.source).filter(Boolean))
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [leads])

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (stageFilter !== 'ALL' && l.status !== stageFilter) return false
      if (sourceFilter !== 'ALL' && l.source !== sourceFilter) return false
      return true
    })
  }, [leads, stageFilter, sourceFilter])

  const handleStageChange = async (leadId: string, newStage: LeadStage) => {
    await updateLead(leadId, { status: newStage })
  }

  const handleLeadClick = (lead: Lead) => {
    setSelectedLead(lead)
    setIsDetailOpen(true)
  }

  const handleUpdate = async (id: string, updates: Partial<Lead>) => {
    const result = await updateLead(id, updates)
    if (result.success && selectedLead?.id === id) {
      setSelectedLead((prev) => (prev ? { ...prev, ...updates } : prev))
    }
    return result
  }

  const handleDelete = async (id: string) => {
    return deleteLead(id)
  }

  // ── Stage stats ─────────────────────────────────────────────────────────────
  // Uses resolved status (from resolveCanonicalStage), so 'convertido' legacy
  // records now appear under 'lead' instead of being invisible.
  const stageStats = useMemo(() => {
    const counts: Record<string, number> = {
      lead: 0,
      whatsapp: 0,
      appointment: 0,
      treatment: 0,
      closed: 0,
    }
    for (const l of leads) {
      const stage = l.status ?? ''
      if (stage in counts) counts[stage]++
    }
    return counts
  }, [leads])

  // ── Appointment coverage ────────────────────────────────────────────────────
  // Counts only leads where the cita is temporally attributable (cita >= captación)
  // OR has a verified phone-match in lead_appointment_matches.
  // This eliminates the 69 legacy backfill cases with appointment_date < created_at.
  const appointmentCoverage = useMemo(() => {
    if (leads.length === 0) return null
    const withEvidence = leads.filter(hasVerifiedAppointmentEvidence).length
    return {
      count: withEvidence,
      pct: Number.parseFloat(((withEvidence / leads.length) * 100).toFixed(1)),
    }
  }, [leads])

  // ── WhatsApp coverage ───────────────────────────────────────────────────────
  // Leads in 'whatsapp' stage require a persisted conversation record.
  // Currently 0 in production — this surfaces that gap explicitly.
  const whatsappCoverage = useMemo(() => {
    return leads.filter((l) => l.status === 'whatsapp').length
  }, [leads])

  // ── Data freshness ──────────────────────────────────────────────────────────
  const dataFreshness = useMemo(() => {
    const timestamps = leads
      .map((lead) => (lead.created_at ? Date.parse(lead.created_at) : Number.NaN))
      .filter(Number.isFinite)
    if (timestamps.length === 0) return null

    const latestTimestamp = Math.max(...timestamps)
    const ageDays = Math.floor((CRM_LOADED_AT_MS - latestTimestamp) / 86_400_000)
    return {
      latestDate: new Date(latestTimestamp).toLocaleDateString('es-ES'),
      ageDays,
      stale: ageDays > STALE_LEADS_AFTER_DAYS,
    }
  }, [leads])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">CRM</h1>
          <p className="text-muted mt-1">Pipeline de leads — etapas, DNI, motivo de pérdida</p>
          <MetaAccountsInline
            context="Los leads de Meta Ads se trazan contra estas cuentas antes de entrar al CRM."
            className="mt-4 max-w-2xl"
          />
        </div>
      </div>

      {/* ── Staleness warning ─────────────────────────────────────────────── */}
      {!loading && dataFreshness?.stale && (
        <div className="rounded-xl border border-[#E0A020]/30 bg-[#E0A020]/10 px-4 py-3 text-sm text-foreground">
          Datos CRM desactualizados: el último lead cargado es del {dataFreshness.latestDate}.
          Las métricas de este panel no deben interpretarse como actividad actual hasta recuperar
          la ingestión.
        </div>
      )}

      {/* ── Funnel integrity warning ──────────────────────────────────────── */}
      {!loading && leads.length > 0 && (
        <div className="rounded-xl border border-[#5C5550]/20 bg-surface px-4 py-3 text-xs text-muted space-y-1">
          <p className="font-semibold text-foreground text-[11px] uppercase tracking-wider">Estado del funnel · evidencia actual</p>
          <p>
            <span className="font-medium text-foreground">{stageStats.lead}</span> leads captados ·{' '}
            <span className="font-medium text-[#28A745]">{whatsappCoverage}</span> con conversación WhatsApp persistida ·{' '}
            <span className="font-medium text-[#E0A020]">{appointmentCoverage?.count ?? 0}</span> con cita Doctoralia verificada por teléfono
          </p>
          <p className="text-[10px] text-muted">
            Las etapas del Kanban reflejan <code>stage_canonical</code> (evidencia) cuando está
            disponible, y el campo <code>stage</code> (legacy) como fallback mapeado. Los 123
            registros con etiqueta <code>convertido</code> aparecen ahora en columna <em>Lead</em>{' '}
            porque <code>stage_canonical</code> los clasifica como <code>lead</code>.
          </p>
          {orphanCount > 0 && (
            <p className="text-[#E0A020]">
              ⚠ {orphanCount} lead{orphanCount > 1 ? 's' : ''} no pudieron resolverse a una etapa
              válida tras el mapeo. Revisa la consola para el detalle.
            </p>
          )}
        </div>
      )}

      {/* ── Funnel stage stats bar ────────────────────────────────────────── */}
      {!loading && leads.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(
            [
              { key: 'lead', label: 'Lead', color: 'text-primary' },
              { key: 'whatsapp', label: 'WhatsApp', color: 'text-[#28A745]' },
              { key: 'appointment', label: 'Cita', color: 'text-[#E0A020]' },
              { key: 'treatment', label: 'Tratamiento', color: 'text-[#B08B5A]' },
              { key: 'closed', label: 'Cerrado', color: 'text-primary' },
            ] as const
          ).map(({ key, label, color }) => (
            <button
              key={key}
              type="button"
              onClick={() => setStageFilter(stageFilter === key ? 'ALL' : key)}
              className={`bg-card border rounded-xl p-3 text-left transition-colors hover:border-primary/60
                ${stageFilter === key ? 'border-primary/80 bg-card/80' : 'border-border'}`}
            >
              <p className={`text-2xl font-bold ${color}`}>{stageStats[key]}</p>
              <p className="text-xs text-muted mt-0.5 capitalize">{label}</p>
            </button>
          ))}
        </div>
      )}

      {!loading && leads.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
          <p className="text-muted text-sm">No hay leads en el CRM todavía.</p>
          <p className="text-muted text-xs mt-1">
            Los leads de Meta Ads aparecerán aquí automáticamente vía webhook.
          </p>
        </div>
      )}

      {/* ── Appointment coverage footnote ─────────────────────────────────── */}
      {appointmentCoverage !== null && !loading && (
        <p className="text-xs text-muted">
          Cobertura de cita verificada:{' '}
          <span className="text-foreground font-medium">{appointmentCoverage.count}</span>{' '}
          ({appointmentCoverage.pct}%) · leads con cita Doctoralia atribuible por teléfono o
          con fecha de cita ≥ fecha de captación. No es una tasa de conversión de cohorte.
        </p>
      )}

      {/* ── Filtros ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
        >
          <option value="ALL">Todas las etapas</option>
          {ALL_STAGES.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
        >
          <option value="ALL">Todas las fuentes</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {(stageFilter !== 'ALL' || sourceFilter !== 'ALL') && (
          <button
            onClick={() => {
              setStageFilter('ALL')
              setSourceFilter('ALL')
            }}
            className="text-xs text-muted hover:text-foreground underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <Tabs defaultValue="pipeline" className="w-full">
        <TabsList>
          <TabsTrigger value="pipeline">Embudo</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4 pt-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted">Cargando embudo...</p>
            </div>
          ) : (
            <KanbanBoard
              leads={filteredLeads}
              onStageChange={handleStageChange}
              onLeadClick={handleLeadClick}
            />
          )}
        </TabsContent>

        <TabsContent value="leads">
          <Card>
            <CardHeader>
              <CardTitle>
                Todos los leads{' '}
                {filteredLeads.length !== leads.length && (
                  <span className="text-sm font-normal text-muted">
                    ({filteredLeads.length} de {leads.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-muted">Obteniendo leads desde Edge Function...</p>
              ) : (
                <div className="space-y-3">
                  {error && <p className="text-sm text-[#E0A020]">{error}</p>}
                  <div className="grid gap-3">
                    {filteredLeads.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        className="rounded-xl border border-border p-4 bg-background text-left cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => handleLeadClick(lead)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-serif font-bold text-foreground">{lead.name}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-surface text-muted border border-border font-medium">
                              {lead.status}
                            </span>
                            {/* Show raw stage when it differs from resolved status */}
                            {lead.stage_raw && lead.stage_raw !== lead.status && (
                              <span
                                className="text-[10px] text-muted font-mono"
                                title={`Etapa original en BD: ${lead.stage_raw}`}
                              >
                                ← {lead.stage_raw}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-[10px] uppercase tracking-wider text-muted mt-1">
                          Origen: {lead.source}
                        </p>
                        {/* Surface verified Doctoralia match inline */}
                        {lead.appointment_matches && lead.appointment_matches.length > 0 && (
                          <p className="text-[10px] text-[#28A745] mt-1">
                            ✓ {lead.appointment_matches.length} cita Doctoralia verificada
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <LeadDetailSheet
        lead={selectedLead}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  )
}
