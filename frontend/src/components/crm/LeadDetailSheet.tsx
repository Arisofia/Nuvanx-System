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

export function LeadDetailSheet({ lead, isOpen, onClose, onUpdate, onDelete }: LeadDetailSheetProps) {
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
  })

  useEffect(() => {
    if (lead) {
      setForm({
        name: lead.name ?? '',
        status: lead.status ?? 'lead',
        phone: lead.phone ?? '',
        dni: lead.dni ?? '',
        notes: lead.notes ?? '',
        revenue: lead.revenue != null ? String(lead.revenue) : '',
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
      revenue: form.revenue !== '' ? Number(form.revenue) : undefined,
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
    if (!window.confirm(`Archive lead "${lead.name}"? This cannot be undone.`)) return
    setDeleting(true)
    await onDelete(lead.id)
    setDeleting(false)
    onClose()
  }

  const field = (label: string, value: string) => (
    <div>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
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
      <label className="text-xs text-slate-500 mb-1 block">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary"
      />
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-all duration-300">
      <div className="absolute inset-0 cursor-pointer" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-slate-900 border-l border-slate-800 shadow-2xl p-6 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-bold text-white">
            {isEditing ? 'Edit Lead' : 'Lead Details'}
          </h2>
          <Button variant="ghost" onClick={onClose} className="text-slate-400 hover:text-white">✕</Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-8">
          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Basic Information</h3>
            <div className="grid gap-4 bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
              {isEditing ? (
                <>
                  {input('Name', 'name')}
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Stage</label>
                    <select
                      value={form.status}
                      onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
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
                    <p className="text-xs text-slate-500 mb-1">Status</p>
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
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Contact Details</h3>
            <div className="grid gap-4 bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
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
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Financials</h3>
            <div className="grid gap-4 bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
              {isEditing ? (
                input('Estimated Revenue (€)', 'revenue', 'number', '0')
              ) : (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Estimated Revenue</p>
                  <p className="text-emerald-500 font-bold text-lg">
                    €{lead.revenue ? Number(lead.revenue).toLocaleString() : '0.00'}
                  </p>
                </div>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Notes</h3>
            <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800/50 min-h-[100px]">
              {isEditing ? (
                <textarea
                  value={form.notes}
                  onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                  rows={4}
                  className="w-full bg-transparent text-sm text-slate-300 resize-none focus:outline-none placeholder-slate-600"
                  placeholder="Add notes..."
                />
              ) : (
                <p className="text-slate-300 text-sm whitespace-pre-wrap">
                  {lead.notes || 'No notes available for this lead.'}
                </p>
              )}
            </div>
          </section>

          {saveError && (
            <p className="text-sm text-rose-500 px-1">{saveError}</p>
          )}
        </div>

        <div className="pt-6 border-t border-slate-800">
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
