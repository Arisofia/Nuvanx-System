import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useLeads } from '../hooks/useLeads'
import { KanbanBoard } from '../components/crm/KanbanBoard'
import { LeadDetailSheet } from '../components/crm/LeadDetailSheet'
import type { Lead, LeadStage } from '../types'

const ALL_STAGES = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'] as const

export default function CRM() {
  const { leads, loading, error, updateLead, deleteLead } = useLeads()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [stageFilter, setStageFilter] = useState<string>('ALL')
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')
  const [isDemo] = useState(false) // Maintaining variable for consistency if needed by other components

  const sources = useMemo(() => {
    const s = new Set(leads.map(l => l.source).filter(Boolean))
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [leads])

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
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
      setSelectedLead(prev => prev ? { ...prev, ...updates } : prev)
    }
    return result
  }

  const handleDelete = async (id: string) => {
    return deleteLead(id)
  }

  const stageStats = useMemo(() => {
    const counts: Record<string, number> = { lead: 0, whatsapp: 0, appointment: 0, treatment: 0, closed: 0 }
    for (const l of leads) {
      const stage = l.status ?? l.stage ?? ''
      if (stage in counts) counts[stage]++
    }
    return counts
  }, [leads])

  const conversionRate = stageStats.lead > 0
    ? Number.parseFloat(((stageStats.appointment / stageStats.lead) * 100).toFixed(1))
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">CRM</h1>
          <p className="text-muted mt-1">Pipeline de leads — etapas, DNI, motivo de pérdida</p>
        </div>
      </div>

      {/* Funnel stage stats bar */}
      {!loading && leads.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {([
            { key: 'lead',        label: 'Lead',       color: 'text-blue-400'   },
            { key: 'whatsapp',    label: 'WhatsApp',   color: 'text-green-400'  },
            { key: 'appointment', label: 'Cita',       color: 'text-yellow-400' },
            { key: 'treatment',   label: 'Tratamiento',color: 'text-orange-400' },
            { key: 'closed',      label: 'Cerrado',    color: 'text-primary'    },
          ] as const).map(({ key, label, color }) => (
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
          <p className="text-muted text-xs mt-1">Los leads de Meta Ads aparecerán aquí automáticamente vía webhook.</p>
        </div>
      )}

      {conversionRate !== null && !loading && (
        <p className="text-xs text-muted">
          Conversión lead → cita: <span className="text-white font-medium">{conversionRate}%</span>
        </p>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
        >
          <option value="ALL">Todas las etapas</option>
          {ALL_STAGES.map(s => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
        >
          <option value="ALL">Todas las fuentes</option>
          {sources.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {(stageFilter !== 'ALL' || sourceFilter !== 'ALL') && (
          <button
            onClick={() => { setStageFilter('ALL'); setSourceFilter('ALL') }}
            className="text-xs text-muted hover:text-white underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {isDemo && (
        <div className="mb-4 p-3 rounded bg-yellow-50 text-xs text-yellow-800 border border-yellow-200">
          Modo demo: algunos datos se muestran con valores simulados porque la API de leads no respondió o faltan credenciales.
        </div>
      )}

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
              <CardTitle>Todos los leads {filteredLeads.length !== leads.length && <span className="text-sm font-normal text-muted">({filteredLeads.length} de {leads.length})</span>}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-muted">Obteniendo leads desde Edge Function...</p>
              ) : (
                <div className="space-y-3">
                  {error && <p className="text-sm text-yellow-500">{error}</p>}
                  <div className="grid gap-3">
                    {filteredLeads.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        className="rounded-xl border border-border p-4 bg-background text-left cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => handleLeadClick(lead)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-white">{lead.name}</p>
                          <span className="text-xs uppercase px-2 py-0.5 rounded bg-surface text-muted border border-[#2d2218]">
                            {lead.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-1">Origen: {lead.source}</p>
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
