import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent } from '../ui/card'
import type { Lead } from '../../types'

interface LeadCardProps {
  lead: Lead
  onClick: (lead: Lead) => void
}

export function LeadCard({ lead, onClick }: Readonly<LeadCardProps>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: lead.id,
    data: {
      type: 'Lead',
      lead
    }
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(lead)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(lead) }}
      className="w-full text-left bg-transparent border-0 p-0 cursor-pointer"
    >
      <Card className="bg-card border-border hover:border-primary/40 transition-colors mb-3 active:cursor-grabbing">
        <CardContent className="p-4">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground truncate">{lead.name}</span>
            {lead.status === 'appointment' && lead.appointment_date && (
              <span className="text-[10px] text-[#E0A020] font-medium">
                📅 {new Date(lead.appointment_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
            {lead.status === 'treatment' && lead.treatment_name && (
              <span className="text-[10px] text-[#B08B5A] font-medium truncate">
                💉 {lead.treatment_name}
              </span>
            )}
            {lead.status === 'closed' && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                ✓ Cerrado
              </span>
            )}
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] uppercase tracking-wider text-muted font-medium">
                {lead.source}
              </span>
              {lead.revenue ? (
                <span className="text-xs font-medium text-emerald-500">
                  €{Number(lead.revenue).toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </button>
  )
}
