import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Brain, CheckCircle2, AlertCircle } from 'lucide-react'
import { invokeApi } from '../../lib/supabaseClient'

export function AgentStatusCard() {
  const [status, setStatus] = useState<{ available: boolean; provider: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const data = await invokeApi('/ai/status')
        setStatus(data)
      } catch (err) {
        console.error('Failed to fetch AI status', err)
      } finally {
        setLoading(false)
      }
    }
    fetchStatus()
  }, [])

  const renderStatus = () => {
    if (loading) {
      return (
        <div className="space-y-3 mt-4">
          <div className="h-12 bg-primary/5 animate-pulse rounded-2xl" />
          <div className="h-4 bg-primary/5 animate-pulse rounded-full w-2/3" />
        </div>
      )
    }

    if (status?.available) {
      return (
        <div className="space-y-4 mt-4">
          <div className="flex items-center gap-3 bg-green-500/5 p-4 rounded-2xl border border-green-500/10">
            <div className="relative">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white animate-pulse" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-green-700">Sistema Activo</p>
              <p className="text-[10px] text-green-600/70 uppercase tracking-widest font-bold">{status.provider}</p>
            </div>
          </div>
          <p className="text-[10px] text-muted font-bold uppercase tracking-wider px-1">
            Insights de IA y generación de contenido habilitados.
          </p>
        </div>
      )
    }

    return (
      <div className="space-y-4 mt-4">
        <div className="flex items-center gap-3 bg-amber-500/5 p-4 rounded-2xl border border-amber-500/10">
          <AlertCircle className="h-6 w-6 text-amber-600" />
          <div>
            <p className="text-sm font-bold text-amber-700">Offline</p>
            <p className="text-[10px] text-amber-600/70 uppercase tracking-widest font-bold">Sin conexión</p>
          </div>
        </div>
        <p className="text-[10px] text-muted font-bold uppercase tracking-wider px-1">
          Conecta OpenAI o Gemini para activar la inteligencia predictiva.
        </p>
      </div>
    )
  }

  return (
    <Card className="hover:shadow-xl transition-all duration-500 group overflow-hidden relative">
      <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity duration-700">
        <Brain className="h-32 w-32 rotate-12" />
      </div>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex flex-col gap-2">
          <CardTitle className="text-xs font-bold text-muted uppercase tracking-[0.2em]">AI Intelligence</CardTitle>
          <div className="h-[1px] w-4 bg-primary/20" />
        </div>
        <div className="bg-primary/5 p-3 rounded-2xl group-hover:bg-primary/10 transition-colors duration-500">
          <Brain className="h-5 w-5 text-primary" />
        </div>
      </CardHeader>
      <CardContent>
        {renderStatus()}
      </CardContent>
    </Card>
  )
}
