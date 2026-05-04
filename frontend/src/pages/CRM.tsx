import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useLeads } from '../hooks/useLeads'
import { KanbanBoard } from '../components/crm/KanbanBoard'
import { LeadDetailSheet } from '../components/crm/LeadDetailSheet'
import type { Lead, LeadStage } from '../types'

<<<<<<< Updated upstream
const ALL_STAGES = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'] as const

export default function CRM() {
  const { leads, loading, error, updateLead, deleteLead } = useLeads()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [stageFilter, setStageFilter] = useState<string>('ALL')
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')
=======
interface Lead {
  id: string
  name: string
  status: string
  source: string
}

const mockLeads: Lead[] = [
  { id: '1', name: 'Ana Martínez', status: 'Contactado', source: 'Doctoralia' },
  { id: '2', name: 'Carlos Pérez', status: 'Calificado', source: 'Web' },
  { id: '3', name: 'Lucía Gómez', status: 'Nuevo', source: 'Doctoralia' },
]

export default function CRM() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isDemo, setIsDemo] = useState(false)
>>>>>>> Stashed changes

  const sources = useMemo(() => {
    const s = new Set(leads.map(l => l.source).filter(Boolean))
    return Array.from(s).sort()
  }, [leads])

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (stageFilter !== 'ALL' && l.status !== stageFilter) return false
      if (sourceFilter !== 'ALL' && l.source !== sourceFilter) return false
      return true
    })
  }, [leads, stageFilter, sourceFilter])

<<<<<<< Updated upstream
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
=======
        if (Array.isArray(data) && data.length > 0) {
          setIsDemo(false)
          setLeads(
            data.map((item: any) => ({
              id: String(item.id ?? item.lead_id ?? ''),
              name: item.name ?? item.full_name ?? item.contact_name ?? 'Desconocido',
              status: item.stage ?? item.status ?? 'Desconocido',
              source: item.source ?? 'Edge',
            })),
          )
        } else {
          throw new Error('No leads returned from API')
        }
      } catch (err: any) {
        console.warn('CRM API call failed, falling back to mock leads:', err)
        setIsDemo(true)
        setError('No se pudieron cargar los leads desde la API; utilizando datos de muestra.')
        setLeads(mockLeads)
      } finally {
        setLoading(false)
      }
>>>>>>> Stashed changes
    }
    return result
  }

  const handleDelete = async (id: string) => {
    return deleteLead(id)
  }

  return (
    <div className="space-y-6">
<<<<<<< Updated upstream
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">CRM</h1>
          <p className="text-slate-400 mt-1">Lead pipeline — stages, DNI, lost_reason</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
        >
          <option value="ALL">All stages</option>
          {ALL_STAGES.map(s => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary"
        >
          <option value="ALL">All sources</option>
          {sources.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {(stageFilter !== 'ALL' || sourceFilter !== 'ALL') && (
          <button
            onClick={() => { setStageFilter('ALL'); setSourceFilter('ALL') }}
            className="text-xs text-slate-400 hover:text-white underline"
          >
            Clear filters
          </button>
        )}
=======
      <div>
        <h1 className="text-3xl font-bold">CRM</h1>
        <p className="text-slate-600 mt-1">Pipeline de leads, etapas y origen de contacto</p>
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4 pt-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-slate-400">Loading pipeline...</p>
            </div>
          ) : (
            <KanbanBoard 
              leads={filteredLeads} 
              onStageChange={handleStageChange} 
              onLeadClick={handleLeadClick} 
            />
          )}
=======
          <TabsTrigger value="stages">Etapas</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {['Nuevo', 'Contactado', 'Calificado', 'Cerrado'].map((stage) => (
              <Card key={stage}>
                <CardHeader>
                  <CardTitle className="text-base">{stage}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">0</p>
                  <p className="text-xs text-slate-500 mt-1">Leads en etapa</p>
                </CardContent>
              </Card>
            ))}
          </div>
>>>>>>> Stashed changes
        </TabsContent>

        <TabsContent value="leads">
          <Card>
            <CardHeader>
<<<<<<< Updated upstream
              <CardTitle>All Leads {filteredLeads.length !== leads.length && <span className="text-sm font-normal text-slate-500">({filteredLeads.length} of {leads.length})</span>}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-slate-400">Fetching leads from Edge Function...</p>
=======
              <CardTitle>Todos los leads</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-slate-600">Cargando leads desde Edge Function...</p>
>>>>>>> Stashed changes
              ) : (
                <div className="space-y-3">
                  {error && <p className="text-sm text-yellow-500">{error}</p>}
                  <div className="grid gap-3">
                    {filteredLeads.map((lead) => (
                      <div 
                        key={lead.id} 
                        className="rounded-xl border border-border p-4 bg-slate-950 cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => handleLeadClick(lead)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-white">{lead.name}</p>
                          <span className="text-xs uppercase px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                            {lead.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">Origen: {lead.source}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
<<<<<<< Updated upstream
=======

        <TabsContent value="stages">
          <Card>
            <CardHeader>
              <CardTitle>Configuración de etapas</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600">Gestiona las etapas y las transiciones del pipeline de leads.</p>
            </CardContent>
          </Card>
        </TabsContent>
>>>>>>> Stashed changes
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
