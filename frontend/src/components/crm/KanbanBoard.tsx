import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core'
import {
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { KanbanColumn } from './KanbanColumn'
import { LeadCard } from './LeadCard'
import type { Lead, LeadStage } from '../../types'

interface KanbanBoardProps {
  leads: Lead[]
  onStageChange: (leadId: string, newStage: LeadStage) => void
  onLeadClick: (lead: Lead) => void
}

const STAGES: { id: LeadStage; title: string }[] = [
  { id: 'lead', title: 'New Leads' },
  { id: 'whatsapp', title: 'WhatsApp' },
  { id: 'appointment', title: 'Appointment' },
  { id: 'treatment', title: 'Treatment' },
  { id: 'closed', title: 'Closed' },
]

export function KanbanBoard({ leads, onStageChange, onLeadClick }: KanbanBoardProps) {
  const [activeLead, setActiveLead] = useState<Lead | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  function handleDragStart(event: DragStartEvent) {
    const { active } = event
    setActiveLead(active.data.current?.lead || null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveLead(null)

    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    // Find the lead being dragged
    const lead = leads.find((l) => l.id === activeId)
    if (!lead) return

    // If dropped over a column (overId will be one of the stages)
    if (STAGES.some(s => s.id === overId)) {
      if (lead.status !== overId) {
        onStageChange(activeId, overId as LeadStage)
      }
      return
    }

    // If dropped over another lead
    const overLead = leads.find((l) => l.id === overId)
    if (overLead && lead.status !== overLead.status) {
      onStageChange(activeId, overLead.status as LeadStage)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-6 overflow-x-auto pb-6 -mx-4 px-4 min-h-[calc(100vh-250px)]">
        {STAGES.map((stage) => (
          <KanbanColumn
            key={stage.id}
            id={stage.id}
            title={stage.title}
            leads={leads.filter((l) => l.status === stage.id)}
            onLeadClick={onLeadClick}
          />
        ))}
      </div>

      <DragOverlay
        dropAnimation={{
          sideEffects: defaultDropAnimationSideEffects({
            styles: {
              active: {
                opacity: '0.5',
              },
            },
          }),
        }}
      >
        {activeLead ? (
          <div className="w-[280px]">
            <LeadCard lead={activeLead} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
