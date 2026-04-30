import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Activity } from 'lucide-react'

export default function Live() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Live Dashboard</h1>
        <p className="text-slate-600 mt-1">Real-time lead flow + activity feed</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>Live Activity Feed</CardTitle>
          <Activity className="h-4 w-4 text-green-500 animate-pulse" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-sm font-medium">New lead received</p>
              <p className="text-xs text-slate-500 mt-1">From Meta Lead Ads • 2 minutes ago</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-sm font-medium">WhatsApp message sent</p>
              <p className="text-xs text-slate-500 mt-1">Follow-up sequence started • 5 minutes ago</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-sm font-medium">Appointment scheduled</p>
              <p className="text-xs text-slate-500 mt-1">Lead moved to stage: Appointment • 12 minutes ago</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4">Connecting to Supabase Realtime...</p>
        </CardContent>
      </Card>
    </div>
  )
}
