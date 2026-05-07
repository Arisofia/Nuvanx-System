import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { LeadCard } from './LeadCard'
import type { Lead, LeadStage } from '../../types'

interface KanbanColumnProps {
  readonly id: LeadStage
  readonly title: string
  readonly leads: Lead[]
  readonly onLeadClick: (lead: Lead) => void
}

export function KanbanColumn({ id, title, leads, onLeadClick }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({
    id
  })

  return (
    <div className="flex flex-col min-w-[280px] w-full bg-surface/50 rounded-xl border border-[#2d2218]/50 p-3 h-full min-h-[500px]">
      <div className="flex items-center justify-between mb-4 px-2">
        <h3 className="text-sm font-bold font-serif text-muted uppercase tracking-widest">
          {title} <span className="ml-2 text-xs font-normal font-sans text-muted">({leads.length})</span>
        </h3>
      </div>

      <div ref={setNodeRef} className="flex-1 overflow-y-auto">
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onClick={onLeadClick} />
          ))}
        </SortableContext>
        {leads.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-[#2d2218] rounded-xl opacity-20">
            <p className="text-xs">No leads</p>
          </div>
        )}
      </div>
    </div>
  )
}
