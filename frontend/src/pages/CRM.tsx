import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useLeads } from '../hooks/useLeads'
import { KanbanBoard } from '../components/crm/KanbanBoard'
import { LeadDetailSheet } from '../components/crm/LeadDetailSheet'
import type { Lead, LeadStage } from '../types'

export default function CRM() {
  const { leads, loading, error, updateLead } = useLeads()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  const handleStageChange = async (leadId: string, newStage: LeadStage) => {
    await updateLead(leadId, { status: newStage })
  }

  const handleLeadClick = (lead: Lead) => {
    setSelectedLead(lead)
    setIsDetailOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">CRM</h1>
          <p className="text-slate-600 mt-1">Lead pipeline — stages, DNI, lost_reason</p>
        </div>
      </div>

      <Tabs defaultValue="pipeline" className="w-full">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4 pt-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-slate-600">Loading pipeline...</p>
            </div>
          ) : (
            <KanbanBoard 
              leads={leads} 
              onStageChange={handleStageChange} 
              onLeadClick={handleLeadClick} 
            />
          )}
        </TabsContent>

        <TabsContent value="leads">
          <Card>
            <CardHeader>
              <CardTitle>All Leads</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-slate-600">Fetching leads from Edge Function...</p>
              ) : (
                <div className="space-y-3">
                  {error && <p className="text-sm text-yellow-500">{error}</p>}
                  <div className="grid gap-3">
                    {leads.map((lead) => (
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
                        <p className="text-xs text-slate-400 mt-1">Source: {lead.source}</p>
                      </div>
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
      />
    </div>
  )
}
