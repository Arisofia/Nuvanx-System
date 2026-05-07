import { useState, useEffect } from 'react'
import { Lead } from '../../types'
import { Button } from '../ui/button'

interface LeadDetailSheetProps {
  lead: Lead | null
  isOpen: boolean
  onClose: () => void
  onUpdate: (id: string, updates: Partial<Lead>) => Promise<{ success: boolean; error?: string }>
  onDelete: (id: string) => Promise<{ success: boolean; error?: string }>
}

const STAGES = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'] as const

export function LeadDetailSheet({ lead, isOpen, onClose, onUpdate, onDelete }: Readonly<LeadDetailSheetProps>) {
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    status: '',
    phone: '',
    dni: '',
    notes: '',
    revenue: '',
    appointment_date: '',
    treatment_name: '',
  })

  useEffect(() => {
    if (lead) {
      setForm({
        name: lead.name ?? '',
        status: lead.status ?? 'lead',
        phone: lead.phone ?? '',
        dni: lead.dni ?? '',
        notes: lead.notes ?? '',
        revenue: lead.revenue == null ? '' : String(lead.revenue),
        appointment_date: lead.appointment_date ?? '',
        treatment_name: lead.treatment_name ?? '',
      })
    }
    setIsEditing(false)
    setSaveError(null)
  }, [lead])

  if (!isOpen || !lead) return null

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    const updates: Partial<Lead> = {
      name: form.name,
      status: form.status,
      phone: form.phone || undefined,
      dni: form.dni || undefined,
      notes: form.notes || undefined,
      revenue: form.revenue === '' ? undefined : Number(form.revenue),
      appointment_date: form.appointment_date || undefined,
      treatment_name: form.treatment_name || undefined,
    }
    const result = await onUpdate(lead.id, updates)
    setSaving(false)
    if (result.success) {
      setIsEditing(false)
    } else {
      setSaveError(result.error ?? 'Failed to save')
    }
  }

  const handleDelete = async () => {
    if (globalThis.confirm(`Archive lead "${lead.name}"? This cannot be undone.`) === false) return
    setDeleting(true)
    await onDelete(lead.id)
    setDeleting(false)
    onClose()
  }

  const field = (label: string, value: string) => (
    <div>
      <p className="text-xs text-muted mb-1">{label}</p>
      <p className="text-white">{value || '—'}</p>
    </div>
  )

  const input = (
    label: string,
    key: keyof typeof form,
    type: string = 'text',
    placeholder?: string
  ) => (
    <div>
      <label className="text-xs text-muted mb-1 block">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-primary"
      />
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-all duration-300">
      <button
        type="button"
        className="absolute inset-0 cursor-pointer"
        aria-label="Cerrar panel"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose() }}
      />
      <div className="relative w-full max-w-md h-full bg-surface border-l border-[#2d2218] shadow-2xl p-6 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-bold text-white">
            {isEditing ? 'Edit Lead' : 'Lead Details'}
          </h2>
          <Button variant="ghost" onClick={onClose} className="text-muted hover:text-white">✕</Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-8">
          <section>
            <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Basic Information</h3>
            <div className="grid gap-4 bg-background/50 rounded-xl p-4 border border-[#2d2218]/50">
              {isEditing ? (
                <>
                  {input('Name', 'name')}
                  <div>
                    <label htmlFor="lead-stage-select" className="text-xs text-muted mb-1 block">Stage</label>
                    <select
                      id="lead-stage-select"
                      value={form.status}
                      onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))}
                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                    >
                      {STAGES.map(s => (
                        <option key={s} value={s} className="capitalize">{s}</option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  {field('Name', lead.name)}
                  <div>
                    <p className="text-xs text-muted mb-1">Status</p>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold uppercase bg-primary/20 text-primary border border-primary/20">
                      {lead.status}
                    </span>
                  </div>
                  {field('Source', lead.source)}
                </>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Contact Details</h3>
            <div className="grid gap-4 bg-background/50 rounded-xl p-4 border border-[#2d2218]/50">
              {isEditing ? (
                <>
                  {input('Phone', 'phone', 'tel', '+34 600 000 000')}
                  {input('DNI / NIF', 'dni', 'text', '12345678X')}
                </>
              ) : (
                <>
                  {field('Email', lead.email ?? '')}
                  {field('Phone', lead.phone ?? '')}
                  {field('DNI', lead.dni ?? '')}
                </>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Financials</h3>
            <div className="grid gap-4 bg-background/50 rounded-xl p-4 border border-[#2d2218]/50">
              {isEditing ? (
                input('Estimated Revenue (€)', 'revenue', 'number', '0')
              ) : (
                <div>
                  <p className="text-xs text-muted mb-1">Estimated Revenue</p>
                  <p className="text-emerald-500 font-bold text-lg">
                    {lead.revenue ? `€${Number(lead.revenue).toLocaleString()}` : '0 €'}
                  </p>
                </div>
              )}
            </div>
          </section>

          {(lead.status === 'appointment' || lead.status === 'treatment' || lead.status === 'closed' || isEditing) && (
            <section>
              <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Pipeline</h3>
              <div className="grid gap-4 bg-background/50 rounded-xl p-4 border border-[#2d2218]/50">
                {isEditing ? (
                  <>
                    {input('Appointment Date', 'appointment_date', 'date')}
                    {input('Treatment / Procedure', 'treatment_name', 'text', 'e.g. Endolift, Combo…')}
                  </>
                ) : (
                  <>
                    {lead.status === 'appointment' && (
                      <div>
                        <p className="text-xs text-muted mb-1">Appointment Date</p>
                        <p className="text-[#E0A020] font-medium">
                          {lead.appointment_date
                            ? new Date(lead.appointment_date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                            : '—'}
                        </p>
                      </div>
                    )}
                    {lead.status === 'treatment' && (
                      <div>
                        <p className="text-xs text-muted mb-1">Treatment / Procedure</p>
                        <p className="text-[#B08B5A] font-medium">{lead.treatment_name || '—'}</p>
                      </div>
                    )}
                    {lead.status === 'closed' && (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">
                          ✓ Cerrado
                        </span>
                        {lead.treatment_name && (
                          <span className="text-xs text-muted">{lead.treatment_name}</span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Notes</h3>            <div className="bg-background/50 rounded-xl p-4 border border-[#2d2218]/50 min-h-[100px]">
              {isEditing ? (
                <textarea
                  value={form.notes}
                  onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                  rows={4}
                  className="w-full bg-transparent text-sm text-[#d7c5ae] resize-none focus:outline-none placeholder-muted"
                  placeholder="Add notes..."
                />
              ) : (
                <p className="text-[#d7c5ae] text-sm whitespace-pre-wrap">
                  {lead.notes || 'No notes available for this lead.'}
                </p>
              )}
            </div>
          </section>

          {saveError && (
            <p className="text-sm text-rose-500 px-1">{saveError}</p>
          )}
        </div>

        <div className="pt-6 border-t border-[#2d2218]">
          {isEditing ? (
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { setIsEditing(false); setSaveError(null) }}
                className="flex-1"
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={handleSave} className="flex-1" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleDelete}
                disabled={deleting}
                className="text-rose-500 border-rose-500/30 hover:bg-rose-500/10"
              >
                {deleting ? '…' : 'Archive'}
              </Button>
              <Button variant="outline" onClick={onClose} className="flex-1">
                Close
              </Button>
              <Button onClick={() => setIsEditing(true)} className="flex-1">
                Edit
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
