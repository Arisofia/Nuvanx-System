import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Play, Plus } from 'lucide-react'

export default function Playbooks() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Playbooks</h1>
          <p className="text-slate-600 mt-1">Automation playbooks for lead nurturing and follow-up</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          New Playbook
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead Qualification Flow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">Automated WhatsApp sequence for new leads</p>
            <div className="space-y-2">
              <div className="text-xs p-2 bg-slate-50 rounded">Step 1: Send intro message</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Step 2: Wait 2 hours</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Step 3: Send qualification questions</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Step 4: Route to agent if qualified</div>
            </div>
            <Button variant="outline" size="sm" className="w-full gap-2">
              <Play className="w-3 h-3" />
              Run Playbook
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Appointment Reminder</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">Send reminders 24h before scheduled appointments</p>
            <div className="space-y-2">
              <div className="text-xs p-2 bg-slate-50 rounded">Trigger: Appointment scheduled</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Wait: 24 hours before appointment</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Action: Send WhatsApp reminder</div>
              <div className="text-xs p-2 bg-slate-50 rounded">Action: Log interaction</div>
            </div>
            <Button variant="outline" size="sm" className="w-full gap-2">
              <Play className="w-3 h-3" />
              Run Playbook
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
