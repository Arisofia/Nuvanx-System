import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useLeads } from '../hooks/useLeads'
import { LeadDetailSheet } from '../components/crm/LeadDetailSheet'
import type { Lead } from '../types'
import { MetaAccountsInline } from '../components/MetaAccountsNotice'
import {
  PIPELINE_STAGES,
  hasCanonicalAppointmentEvidence,
  isNewClientPipelineStage,
  pipelineStageLabel,
} from '../lib/pipeline'

const STALE_LEADS_AFTER_DAYS = 7
const CRM_LOADED_AT_MS = Date.now()

function formatJourneyDate(value: string | null | undefined) {
  if (!value) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return value
  return new Date(year, month - 1, day).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function stageEvidenceDate(lead: Lead) {
  switch (lead.status) {
    case 'valuation_scheduled':
    case 'valuation_completed':
      return lead.valuation_appointment_date
    case 'treatment_scheduled':
    case 'treatment_completed':
      return lead.treatment_appointment_date
    case 'control_scheduled':
    case 'client_completed':
      return lead.first_control_appointment_date
    default:
      return null
  }
}

export default function CRM() {
  const { leads, loading, error, updateLead, deleteLead } = useLeads()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [stageFilter, setStageFilter] = useState<string>('ALL')
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')

  const sources = useMemo(() => {
    const values = new Set(leads.map((lead) => lead.source).filter(Boolean))
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [leads])

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (stageFilter !== 'ALL' && lead.status !== stageFilter) return false
      if (sourceFilter !== 'ALL' && lead.source !== sourceFilter) return false
      return true
    })
  }, [leads, stageFilter, sourceFilter])

  const pipelineStagesToRender = useMemo(
    () => stageFilter === 'ALL'
      ? PIPELINE_STAGES
      : PIPELINE_STAGES.filter((stage) => stage.id === stageFilter),
    [stageFilter],
  )

  const handleLeadClick = (lead: Lead) => {
    setSelectedLead(lead)
    setIsDetailOpen(true)
  }

  const handleUpdate = async (id: string, updates: Partial<Lead>) => {
    const result = await updateLead(id, updates)
    if (result.success && selectedLead?.id === id) {
      setSelectedLead((previous) => previous
        ? { ...previous, ...updates, status: previous.status }
        : previous)
    }
    return result
  }

  const handleDelete = async (id: string) => deleteLead(id)

  const stageStats = useMemo(() => {
    const counts = Object.fromEntries(
      PIPELINE_STAGES.map((stage) => [stage.id, 0]),
    ) as Record<string, number>
    for (const lead of leads) {
      if (lead.status in counts) counts[lead.status] += 1
    }
    return counts
  }, [leads])

  const journeyCoverage = useMemo(() => {
    const valuation = leads.filter((lead) => Number(lead.journey_appointment_count ?? 0) >= 1).length
    const treatment = leads.filter((lead) => Number(lead.journey_appointment_count ?? 0) >= 2).length
    const control = leads.filter((lead) => Number(lead.journey_appointment_count ?? 0) >= 3).length
    const newClients = leads.filter(
      (lead) => lead.is_new_client === true || isNewClientPipelineStage(lead.status),
    ).length
    return { valuation, treatment, control, newClients }
  }, [leads])

  const appointmentCoverage = useMemo(() => {
    if (leads.length === 0) return null
    const withEvidence = leads.filter((lead) => hasCanonicalAppointmentEvidence(lead.status)).length
    return {
      count: withEvidence,
      percentage: Number.parseFloat(((withEvidence / leads.length) * 100).toFixed(1)),
    }
  }, [leads])

  const dataFreshness = useMemo(() => {
    const timestamps = leads
      .map((lead) => lead.created_at ? Date.parse(lead.created_at) : Number.NaN)
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
          <p className="text-muted mt-1">
            Journey comercial canónico · Valoración → Tratamiento → 1er control
          </p>
          <MetaAccountsInline
            context="Los leads de Meta Ads se trazan contra estas cuentas antes de entrar al CRM."
            className="mt-4 max-w-2xl"
          />
        </div>
      </div>

      {!loading && error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-foreground">
          <p className="font-medium">Pipeline canónico no disponible.</p>
          <p className="mt-1 text-xs text-muted">{error}</p>
        </div>
      )}

      {!loading && !error && dataFreshness?.stale && (
        <div className="rounded-xl border border-[#E0A020]/30 bg-[#E0A020]/10 px-4 py-3 text-sm text-foreground">
          Datos CRM desactualizados: el último lead cargado es del {dataFreshness.latestDate}.
          Las métricas no deben interpretarse como actividad actual hasta recuperar la ingestión.
        </div>
      )}

      {!loading && !error && leads.length > 0 && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-muted space-y-1">
          <p className="font-semibold text-foreground text-[11px] uppercase tracking-wider">
            Regla de atribución clínica
          </p>
          <p>
            La secuencia Doctoralia determina el avance: <strong>1ª cita = valoración</strong> ·{' '}
            <strong>2ª = tratamiento</strong> · <strong>3ª = 1er control</strong>.
            El nombre de la cita puede ser “revisión” y no altera la posición del journey.
          </p>
          <p className="text-[10px]">
            Citas anuladas o “no acude” no consumen posición. Un cobro suma revenue financiero,
            pero nunca convierte por sí solo un lead en cliente.
          </p>
        </div>
      )}

      {!loading && !error && leads.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: '1/3 · Valoración', value: journeyCoverage.valuation },
            { label: '2/3 · Tratamiento', value: journeyCoverage.treatment },
            { label: '3/3 · 1er control', value: journeyCoverage.control },
            { label: 'Clientes nuevos', value: journeyCoverage.newClients },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-2xl font-bold text-primary">{metric.value}</p>
              <p className="text-xs text-muted mt-1">{metric.label}</p>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && leads.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {PIPELINE_STAGES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setStageFilter(stageFilter === id ? 'ALL' : id)}
              className={`bg-card border rounded-xl p-3 text-left transition-colors hover:border-primary/60 ${
                stageFilter === id ? 'border-primary/80 bg-card/80' : 'border-border'
              }`}
            >
              <p className="text-2xl font-bold text-primary">{stageStats[id]}</p>
              <p className="text-xs text-muted mt-0.5">{label}</p>
            </button>
          ))}
        </div>
      )}

      {!loading && !error && leads.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
          <p className="text-muted text-sm">No hay registros en el pipeline canónico.</p>
        </div>
      )}

      {appointmentCoverage !== null && !loading && !error && (
        <p className="text-xs text-muted">
          Leads con evidencia Doctoralia dentro del journey:{' '}
          <span className="text-foreground font-medium">
            {appointmentCoverage.count} · {appointmentCoverage.percentage}%
          </span>
          . La conversión a cliente nuevo requiere llegar al tercer paso; revenue y pagos se miden aparte.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <select
          value={stageFilter}
          onChange={(event) => setStageFilter(event.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
        >
          <option value="ALL">Todas las etapas canónicas</option>
          {PIPELINE_STAGES.map((stage) => (
            <option key={stage.id} value={stage.id}>{stage.label}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
        >
          <option value="ALL">Todas las fuentes</option>
          {sources.map((source) => (
            <option key={source} value={source}>{source}</option>
          ))}
        </select>
        {(stageFilter !== 'ALL' || sourceFilter !== 'ALL') && (
          <button
            type="button"
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
          <TabsTrigger value="pipeline">Pipeline canónico</TabsTrigger>
          <TabsTrigger value="leads">Registros</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4 pt-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted">Cargando pipeline canónico...</p>
            </div>
          ) : !error ? (
            <>
              <p className="text-xs text-muted">
                Las etapas clínicas son de solo lectura: el sistema las deriva de Doctoralia.
                No se permite arrastrar un lead para fabricar una valoración, tratamiento o control.
              </p>
              <div className="flex gap-4 overflow-x-auto pb-6 -mx-4 px-4 min-h-[420px]">
                {pipelineStagesToRender.map((stage) => {
                  const stageLeads = filteredLeads.filter((lead) => lead.status === stage.id)
                  return (
                    <div
                      key={stage.id}
                      className="flex flex-col min-w-[280px] w-full max-w-[340px] bg-surface/50 rounded-xl border border-border p-3 min-h-[390px]"
                    >
                      <div className="flex items-center justify-between mb-4 px-2">
                        <h3 className="text-xs font-bold font-serif text-muted uppercase tracking-widest">
                          {stage.label}{' '}
                          <span className="font-normal font-sans">({stageLeads.length})</span>
                        </h3>
                      </div>
                      <div className="space-y-3 overflow-y-auto">
                        {stageLeads.map((lead) => {
                          const evidenceDate = formatJourneyDate(stageEvidenceDate(lead))
                          return (
                            <button
                              key={lead.id}
                              type="button"
                              onClick={() => handleLeadClick(lead)}
                              className="w-full rounded-xl border border-border bg-card p-4 text-left hover:border-primary/50 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="font-semibold text-foreground truncate">{lead.name}</p>
                                {lead.is_new_client && (
                                  <span className="shrink-0 rounded-full border border-[#28A745]/30 bg-[#28A745]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#28A745]">
                                    Cliente nuevo
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-[10px] uppercase tracking-wider text-muted">
                                {lead.source} · {Math.min(Number(lead.journey_appointment_count ?? 0), 3)}/3 citas
                              </p>
                              {evidenceDate && (
                                <p className="mt-2 text-[10px] font-medium text-[#E0A020]">{evidenceDate}</p>
                              )}
                            </button>
                          )
                        })}
                        {stageLeads.length === 0 && (
                          <div className="flex items-center justify-center h-28 rounded-xl border border-dashed border-border text-xs text-muted">
                            Sin registros
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="leads">
          <Card>
            <CardHeader>
              <CardTitle>
                Todos los registros{' '}
                {filteredLeads.length !== leads.length && (
                  <span className="text-sm font-normal text-muted">
                    ({filteredLeads.length} de {leads.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-muted">Obteniendo leads y pipeline canónico...</p>
              ) : !error ? (
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
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-surface text-muted border border-border font-medium">
                          {pipelineStageLabel(lead.status)}
                        </span>
                      </div>
                      <p className="text-[10px] uppercase tracking-wider text-muted mt-1">
                        Origen: {lead.source} · Journey: {Math.min(Number(lead.journey_appointment_count ?? 0), 3)}/3
                      </p>
                      {lead.is_new_client && (
                        <p className="mt-1 text-[10px] font-medium text-[#28A745]">
                          Cliente nuevo por secuencia Doctoralia completa
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
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
