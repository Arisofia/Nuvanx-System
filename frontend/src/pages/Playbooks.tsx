import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Play, Plus, AlertCircle } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'
import type { Playbook, RunResult } from '../types'

export default function Playbooks() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, RunResult>>({})

  useEffect(() => {
    invokeApi('/playbooks')
      .then((data: any) => {
        setPlaybooks(Array.isArray(data?.playbooks) ? data.playbooks : [])
        setLoading(false)
      })
      .catch((err: any) => {
        setError(err?.message || 'Failed to load playbooks.')
        setLoading(false)
      })
  }, [])

  const runPlaybook = async (pb: Playbook) => {
    setRuns((prev) => ({ ...prev, [pb.id]: { playbookId: pb.id, loading: true, result: null, error: null } }))
    try {
      const data: any = await invokeApi(`/playbooks/${pb.slug}/run`, { method: 'POST', body: {} })
      if (!data?.success) throw new Error(data?.message || 'Playbook run failed')
      setRuns((prev) => ({ ...prev, [pb.id]: { playbookId: pb.id, loading: false, result: data.generatedMessage ?? data.result ?? 'Done', error: null } }))
      setPlaybooks((prev) => prev.map((p) => p.id === pb.id ? { ...p, runs: p.runs + 1 } : p))
    } catch (err: any) {
      setRuns((prev) => ({ ...prev, [pb.id]: { playbookId: pb.id, loading: false, result: null, error: err?.message || 'Run failed' } }))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Playbooks</h1>
<<<<<<< Updated upstream
          <p className="text-slate-400 mt-1">Automation playbooks for lead nurturing and follow-up</p>
=======
          <p className="text-slate-600 mt-1">Flujos de automatización para nurturing y seguimiento premium</p>
>>>>>>> Stashed changes
        </div>
        <Button className="gap-2" disabled>
          <Plus className="w-4 h-4" />
          Crear playbook
        </Button>
      </div>

<<<<<<< Updated upstream
      {loading && (
        <div className="animate-pulse space-y-4">
          <div className="h-40 bg-slate-800 rounded-lg" />
          <div className="h-40 bg-slate-800 rounded-lg" />
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-950/40 border border-red-800 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {!loading && !error && playbooks.length === 0 && (
        <p className="text-slate-500 text-sm">No playbooks found. Add them in the database.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {playbooks.map((pb) => {
          const run = runs[pb.id]
          return (
            <Card key={pb.id}>
              <CardHeader>
                <CardTitle className="text-base">{pb.title ?? pb.name}</CardTitle>
                {pb.category && <p className="text-xs text-slate-400 mt-1 uppercase tracking-wide">{pb.category}</p>}
              </CardHeader>
              <CardContent className="space-y-3">
                {pb.description && <p className="text-sm text-slate-400">{pb.description}</p>}
                {pb.steps.length > 0 && (
                  <div className="space-y-1">
                    {pb.steps.map((step: any, i: number) => (
                        <div key={i} className="text-xs p-2 bg-slate-800 rounded text-slate-300">
                        {typeof step === 'string' ? step : step?.label ?? step?.action ?? JSON.stringify(step)}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Runs: {pb.runs}</span>
                  {pb.lastRunAt && <span>Last: {new Date(pb.lastRunAt).toLocaleDateString()}</span>}
                </div>
                {run?.result && (
                  <div className="rounded-md bg-emerald-950/40 border border-emerald-800 p-3 text-xs text-emerald-300 whitespace-pre-wrap">{run.result}</div>
                )}
                {run?.error && (
                  <div className="rounded-md bg-red-950/40 border border-red-800 p-3 text-xs text-red-300">{run.error}</div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  disabled={run?.loading || pb.status === 'archived'}
                  onClick={() => runPlaybook(pb)}
                >
                  <Play className="w-3 h-3" />
                  {run?.loading ? 'Running…' : 'Run Playbook'}
                </Button>
              </CardContent>
            </Card>
          )
        })}
=======
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Flujo de cualificación</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">Secuencia automática de WhatsApp para leads nuevos</p>
            <div className="space-y-2">
              <div className="text-xs p-2 bg-slate-50 rounded">Paso 1: Enviar mensaje inicial</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Paso 2: Esperar 2 horas</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Paso 3: Enviar preguntas de cualificación</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Paso 4: Derivar a agente si está cualificado</div>
            </div>
            <Button variant="outline" size="sm" className="w-full gap-2">
              <Play className="w-3 h-3" />
              Ejecutar flujo
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recordatorio de cita</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">Envía recordatorios 24h antes de la cita programada</p>
            <div className="space-y-2">
              <div className="text-xs p-2 bg-slate-50 rounded">Disparo: cita agendada</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Espera: 24 horas antes</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Acción: enviar recordatorio WhatsApp</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Acción: registrar interacción</div>
            </div>
            <Button variant="outline" size="sm" className="w-full gap-2">
              <Play className="w-3 h-3" />
              Ejecutar flujo
            </Button>
          </CardContent>
        </Card>
>>>>>>> Stashed changes
      </div>
    </div>
  )
}
