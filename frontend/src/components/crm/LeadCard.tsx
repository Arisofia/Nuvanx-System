import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent } from '../ui/card'
import type { Lead } from '../../types'

interface LeadCardProps {
  lead: Lead
  onClick: (lead: Lead) => void
}

export function LeadCard({ lead, onClick }: LeadCardProps) {
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
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(lead)}
      className="cursor-pointer"
    >
      <Card className="bg-slate-950 border-slate-800 hover:border-slate-700 transition-colors mb-3 active:cursor-grabbing">
        <CardContent className="p-4">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-white truncate">{lead.name}</span>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
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
    </div>
  )
}
