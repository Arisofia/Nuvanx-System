import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Play, Plus, AlertCircle } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'

interface Playbook {
  id: string
  slug: string
  title: string
  name: string
  description?: string
  category?: string
  status: string
  steps: string[]
  runs: number
  lastRunAt?: string | null
}

interface RunResult {
  playbookId: string
  loading: boolean
  result: string | null
  error: string | null
}

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
          <p className="text-slate-600 mt-1">Automation playbooks for lead nurturing and follow-up</p>
        </div>
        <Button className="gap-2" disabled>
          <Plus className="w-4 h-4" />
          New Playbook
        </Button>
      </div>

      {loading && (
        <div className="animate-pulse space-y-4">
          <div className="h-40 bg-slate-200 rounded-lg" />
          <div className="h-40 bg-slate-200 rounded-lg" />
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
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
                {pb.description && <p className="text-sm text-slate-600">{pb.description}</p>}
                {pb.steps.length > 0 && (
                  <div className="space-y-1">
                    {pb.steps.map((step: any, i: number) => (
                      <div key={i} className="text-xs p-2 bg-slate-50 rounded">
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
                  <div className="rounded-md bg-green-50 border border-green-200 p-3 text-xs text-green-800 whitespace-pre-wrap">{run.result}</div>
                )}
                {run?.error && (
                  <div className="rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-800">{run.error}</div>
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
      </div>
    </div>
  )
}
