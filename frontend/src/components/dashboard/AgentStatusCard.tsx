import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Brain, CheckCircle2, AlertCircle } from 'lucide-react'
import { invokeApi } from '../../lib/supabaseClient'
import { Badge } from '../ui/badge'

export function AgentStatusCard() {
  const [status, setStatus] = useState<{ available: boolean; provider: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStatus() {
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">AI Agent Status</CardTitle>
        <Brain className="h-4 w-4 text-muted" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-10 animate-pulse bg-card rounded mt-2" />
        ) : status?.available ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mt-2">
              <CheckCircle2 className="h-5 w-5 text-[#8ee0b8]" />
              <span className="font-bold">Online</span>
              <Badge className="ml-auto capitalize">
                {status.provider}
              </Badge>
            </div>
            <p className="text-xs text-muted">
              AI insights and content generation active.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mt-2">
              <AlertCircle className="h-5 w-5 text-[#f2b24b]" />
              <span className="font-bold">Action Required</span>
            </div>
            <p className="text-xs text-muted">
              Connect OpenAI or Gemini to enable AI features.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
