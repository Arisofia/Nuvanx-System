import { Lead } from '../../types'
import { Button } from '../ui/button'

interface LeadDetailSheetProps {
  lead: Lead | null
  isOpen: boolean
  onClose: () => void
}

export function LeadDetailSheet({ lead, isOpen, onClose }: LeadDetailSheetProps) {
  if (!isOpen || !lead) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-all duration-300">
      <div 
        className="absolute inset-0 cursor-pointer" 
        onClick={onClose}
      />
      <div className="relative w-full max-w-md h-full bg-slate-900 border-l border-slate-800 shadow-2xl p-6 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-bold text-white">Lead Details</h2>
          <Button variant="ghost" onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-8">
          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Basic Information</h3>
            <div className="grid gap-4 bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
              <div>
                <p className="text-xs text-slate-500 mb-1">Name</p>
                <p className="text-white font-medium">{lead.name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Status</p>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold uppercase bg-primary/20 text-primary border border-primary/20">
                  {lead.status}
                </span>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Source</p>
                <p className="text-white">{lead.source}</p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Contact Details</h3>
            <div className="grid gap-4 bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
              <div>
                <p className="text-xs text-slate-500 mb-1">Email</p>
                <p className="text-white">{lead.email || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Phone</p>
                <p className="text-white">{lead.phone || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">DNI</p>
                <p className="text-white">{lead.dni || '—'}</p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Financials</h3>
            <div className="grid gap-4 bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
              <div>
                <p className="text-xs text-slate-500 mb-1">Estimated Revenue</p>
                <p className="text-emerald-500 font-bold text-lg">
                  €{lead.revenue ? Number(lead.revenue).toLocaleString() : '0.00'}
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Notes</h3>
            <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800/50 min-h-[100px]">
              <p className="text-slate-300 text-sm whitespace-pre-wrap">
                {lead.notes || 'No notes available for this lead.'}
              </p>
            </div>
          </section>
        </div>

        <div className="pt-6 border-t border-slate-800 flex gap-3">
          <Button onClick={onClose} className="flex-1" variant="outline">
            Close
          </Button>
          <Button disabled className="flex-1">
            Edit (Phase 3)
          </Button>
        </div>
      </div>
    </div>
  )
}
