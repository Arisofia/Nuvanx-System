import { useEffect, useState } from 'react'
import { CheckCircle2, Clock3, MessageCircle, Send, XCircle } from 'lucide-react'
import type { Lead } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import { Button } from '../ui/button'

interface LeadDetailSheetProps {
  lead: Lead | null
  isOpen: boolean
  onClose: () => void
  onUpdate: (id: string, updates: Partial<Lead>) => Promise<{ success: boolean; error?: string }>
  onDelete: (id: string) => Promise<{ success: boolean; error?: string }>
}

const STAGES = [
  { value: 'lead', label: 'Lead' },
  { value: 'whatsapp', label: 'En conversación' },
  { value: 'appointment', label: 'Cita' },
  { value: 'treatment', label: 'Tratamiento' },
  { value: 'closed', label: 'Cerrado' },
] as const

type WhatsappResult = {
  ok: boolean
  pending?: boolean
  message: string
}

function defaultWhatsappDraft(name: string) {
  const firstName = name.trim().split(/\s+/)[0] || ''
  return `Hola${firstName ? ` ${firstName}` : ''}, soy del equipo de NUVANX Medicina Estética Láser. Te escribo para ayudarte con tu solicitud de valoración. ¿Qué momento te viene bien para hablar?`
}

function normalizeWhatsappPhone(value: string) {
  const raw = value.trim()
  const hasLeadingPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  return `${hasLeadingPlus ? '+' : ''}${digits}`
}

function createWhatsappIntentKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const random = new Uint8Array(16)
  globalThis.crypto.getRandomValues(random)
  return Array.from(random, value => value.toString(16).padStart(2, '0')).join('')
}

async function readFunctionErrorPayload(error: unknown): Promise<Record<string, unknown> | null> {
  const context = (error as { context?: unknown } | null)?.context
  if (!(context instanceof Response)) return null
  try {
    return await context.clone().json() as Record<string, unknown>
  } catch {
    return null
  }
}

export function LeadDetailSheet({ lead, isOpen, onClose, onUpdate, onDelete }: Readonly<LeadDetailSheetProps>) {
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [whatsappDraft, setWhatsappDraft] = useState('')
  const [whatsappSending, setWhatsappSending] = useState(false)
  const [whatsappIntentKey, setWhatsappIntentKey] = useState<string | null>(null)
  const [whatsappResult, setWhatsappResult] = useState<WhatsappResult | null>(null)
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
      setWhatsappDraft(defaultWhatsappDraft(lead.name ?? ''))
    }
    setIsEditing(false)
    setSaveError(null)
    setWhatsappResult(null)
    setWhatsappSending(false)
    setWhatsappIntentKey(null)
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
      setSaveError(result.error ?? 'No se pudo guardar la ficha.')
    }
  }

  const handleDelete = async () => {
    if (globalThis.confirm(`¿Archivar el lead "${lead.name}"? Esta acción no se puede deshacer.`) === false) return
    setDeleting(true)
    await onDelete(lead.id)
    setDeleting(false)
    onClose()
  }

  const handleWhatsappDraftChange = (value: string) => {
    setWhatsappDraft(value)
    // An idempotency key fingerprints one exact send intent. Editing creates a new intent.
    setWhatsappIntentKey(null)
    setWhatsappResult(null)
  }

  const handleWhatsappSend = async () => {
    const phone = normalizeWhatsappPhone(String(lead.phone || ''))
    const message = whatsappDraft.trim()
    if (!phone) {
      setWhatsappResult({ ok: false, message: 'Este paciente no tiene teléfono registrado.' })
      return
    }
    if (!message) {
      setWhatsappResult({ ok: false, message: 'Escribe un mensaje antes de enviarlo.' })
      return
    }
    if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
      setWhatsappResult({ ok: false, message: 'El teléfono debe ser válido y preferiblemente incluir el prefijo internacional, por ejemplo +34XXXXXXXXX.' })
      return
    }

    const confirmed = globalThis.confirm(`¿Enviar este WhatsApp a ${lead.name} (${phone})?`)
    if (!confirmed) return

    const intentKey = whatsappIntentKey || createWhatsappIntentKey()
    if (!whatsappIntentKey) setWhatsappIntentKey(intentKey)

    setWhatsappSending(true)
    setWhatsappResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-send', {
        body: { to: phone, message, lead_id: lead.id, idempotency_key: intentKey },
      })

      if (error) {
        const payload = await readFunctionErrorPayload(error)
        const providerStatus = String(payload?.providerStatus || '')
        if (providerStatus === 'failed') setWhatsappIntentKey(null)
        const failureMessage = String(payload?.message || (error as Error).message || 'WhatsApp no confirmó la solicitud.')
        const pending = payload?.pending === true || providerStatus === 'unknown'
        setWhatsappResult({ ok: false, pending, message: failureMessage })
        return
      }

      if (!data?.success) {
        if (data?.providerStatus === 'failed') setWhatsappIntentKey(null)
        setWhatsappResult({
          ok: false,
          pending: data?.pending === true || data?.providerStatus === 'unknown',
          message: data?.message || 'WhatsApp no confirmó la solicitud.',
        })
        return
      }

      if (data?.pending === true || data?.providerStatus === 'unknown') {
        setWhatsappResult({
          ok: false,
          pending: true,
          message: data?.message || 'Solicitud registrada. El resultado del proveedor aún no está confirmado; no reenvíes con una intención nueva.',
        })
        return
      }

      // Meta returned a durable message id / known prior provider result. A later webhook proves delivery/read.
      setWhatsappIntentKey(null)
      setWhatsappResult({
        ok: true,
        message: data?.messageId
          ? `Aceptado por Meta. Entrega pendiente de confirmación. ID: ${String(data.messageId)}`
          : 'Aceptado por Meta. Entrega pendiente de confirmación.',
      })
    } catch (error: unknown) {
      // Keep the same key after a transport exception: retrying the same intent must remain idempotent.
      const message = error instanceof Error ? error.message : 'No se pudo confirmar la solicitud de WhatsApp.'
      setWhatsappResult({ ok: false, pending: true, message: `${message} No crees un segundo envío; vuelve a intentar con la misma intención.` })
    } finally {
      setWhatsappSending(false)
    }
  }

  const field = (label: string, value: string) => (
    <div>
      <p className="text-xs text-muted mb-1">{label}</p>
      <p className="text-foreground">{value || '—'}</p>
    </div>
  )

  const input = (label: string, key: keyof typeof form, type: string = 'text') => (
    <div>
      <label className="text-xs text-muted mb-1 block">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
      />
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-sm transition-all duration-300">
      <button type="button" className="absolute inset-0 cursor-pointer" aria-label="Cerrar panel" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-background border-l border-border shadow-2xl p-6 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Paciente / Lead</p>
            <h2 className="mt-1 text-xl font-bold text-foreground">{isEditing ? 'Editar ficha' : lead.name}</h2>
          </div>
          <Button variant="ghost" onClick={onClose} className="text-muted hover:text-foreground" aria-label="Cerrar">×</Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-7 pr-1">
          <section>
            <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Información básica</h3>
            <div className="grid gap-4 bg-card rounded-xl p-4 border border-border">
              {isEditing ? (
                <>
                  {input('Nombre', 'name')}
                  <div>
                    <label htmlFor="lead-stage-select" className="text-xs text-muted mb-1 block">Etapa</label>
                    <select
                      id="lead-stage-select"
                      value={form.status}
                      onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))}
                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                    >
                      {STAGES.map(stage => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-muted mb-1">Estado</p>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold uppercase bg-primary/15 text-primary border border-primary/20">{STAGES.find(stage => stage.value === lead.status)?.label || lead.status}</span>
                  </div>
                  {field('Origen', lead.source)}
                </>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Contacto</h3>
            <div className="grid gap-4 bg-card rounded-xl p-4 border border-border">
              {isEditing ? (
                <>
                  {input('Teléfono', 'phone', 'tel')}
                  {input('DNI / NIF', 'dni')}
                </>
              ) : (
                <>
                  {field('Email', lead.email ?? '')}
                  {field('Teléfono', lead.phone ?? '')}
                  {field('DNI', lead.dni ?? '')}
                </>
              )}
            </div>
          </section>

          {!isEditing && (
            <section data-testid="direct-whatsapp-workspace">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted"><MessageCircle className="h-4 w-4 text-primary" />WhatsApp directo</h3>
                <span className="rounded-full border border-border bg-card px-2 py-1 text-[10px] font-semibold text-muted">Meta Cloud API</span>
              </div>
              <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                <p className="text-xs leading-5 text-muted">Edita el mensaje y confirma el envío. NUVANX registra una intención idempotente; la aceptación de Meta y la entrega al paciente son estados diferentes.</p>
                <textarea
                  value={whatsappDraft}
                  onChange={(event) => handleWhatsappDraftChange(event.target.value)}
                  rows={5}
                  maxLength={4096}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground focus:outline-none focus:border-primary"
                  placeholder="Escribe el mensaje…"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[10px] text-muted">{whatsappDraft.length}/4096 · {lead.phone || 'sin teléfono'}</span>
                  <Button type="button" onClick={() => void handleWhatsappSend()} disabled={whatsappSending || !lead.phone} className="gap-2">
                    <Send className="h-3.5 w-3.5" />{whatsappSending ? 'Enviando…' : 'Enviar WhatsApp'}
                  </Button>
                </div>
                {whatsappResult && (
                  <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                    whatsappResult.pending
                      ? 'border-amber-500/25 bg-amber-500/8 text-amber-700'
                      : whatsappResult.ok
                        ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-700'
                        : 'border-rose-500/25 bg-rose-500/8 text-rose-600'
                  }`}>
                    {whatsappResult.pending
                      ? <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
                      : whatsappResult.ok
                        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                    <span>{whatsappResult.message}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Valor económico</h3>
            <div className="grid gap-4 bg-card rounded-xl p-4 border border-border">
              {isEditing ? input('Ingresos estimados (€)', 'revenue', 'number') : (
                <div>
                  <p className="text-xs text-muted mb-1">Ingresos estimados</p>
                  <p className="text-emerald-600 font-bold text-lg">{lead.revenue ? `${Number(lead.revenue).toLocaleString('es-ES')} €` : '0 €'}</p>
                </div>
              )}
            </div>
          </section>

          {(lead.status === 'appointment' || lead.status === 'treatment' || lead.status === 'closed' || isEditing) && (
            <section>
              <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Proceso clínico</h3>
              <div className="grid gap-4 bg-card rounded-xl p-4 border border-border">
                {isEditing ? (
                  <>
                    {input('Fecha de cita', 'appointment_date', 'date')}
                    {input('Tratamiento / procedimiento', 'treatment_name')}
                  </>
                ) : (
                  <>
                    {lead.appointment_date && field('Fecha de cita', new Date(lead.appointment_date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}
                    {lead.treatment_name && field('Tratamiento / procedimiento', lead.treatment_name)}
                    {lead.status === 'closed' && <span className="inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 border border-emerald-500/20">✓ Cerrado</span>}
                  </>
                )}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Notas</h3>
            <div className="bg-card rounded-xl p-4 border border-border min-h-[100px]">
              {isEditing ? (
                <textarea value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} rows={4} className="w-full bg-transparent text-sm text-foreground resize-none focus:outline-none" />
              ) : (
                <p className="text-foreground/80 text-sm whitespace-pre-wrap">{lead.notes || 'Sin notas registradas.'}</p>
              )}
            </div>
          </section>

          {saveError && <p className="text-sm text-rose-500 px-1">{saveError}</p>}
        </div>

        <div className="pt-5 border-t border-border">
          {isEditing ? (
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => { setIsEditing(false); setSaveError(null) }} className="flex-1" disabled={saving}>Cancelar</Button>
              <Button onClick={() => void handleSave()} className="flex-1" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => void handleDelete()} disabled={deleting} className="text-rose-500 border-rose-500/30 hover:bg-rose-500/10">{deleting ? '…' : 'Archivar'}</Button>
              <Button variant="outline" onClick={onClose} className="flex-1">Cerrar</Button>
              <Button onClick={() => setIsEditing(true)} className="flex-1">Editar</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
