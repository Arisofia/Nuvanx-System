import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { CheckCircle2, AlertCircle, Plus } from 'lucide-react'

const integrations = [
  { name: 'Meta Lead Ads', status: 'active', icon: '📱' },
  { name: 'WhatsApp Business', status: 'active', icon: '💬' },
  { name: 'Meta Ads Insights', status: 'active', icon: '📊' },
  { name: 'Google Ads', status: 'active', icon: '🔍' },
  { name: 'OpenAI', status: 'active', icon: '🤖' },
  { name: 'Gemini', status: 'active', icon: '✨' },
  { name: 'GitHub', status: 'active', icon: '🐙' },
  { name: 'Doctoralia', status: 'active', icon: '🏥' },
]

export default function Integrations() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Integrations</h1>
          <p className="text-slate-600 mt-1">Credential vault — Meta, WhatsApp, OpenAI, Gemini, GitHub, Google Ads</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Add Integration
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {integrations.map((integration) => (
          <Card key={integration.name}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">{integration.icon} {integration.name}</CardTitle>
              {integration.status === 'active' ? (
                <Badge className="bg-green-50 text-green-700 border-green-200">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Active
                </Badge>
              ) : (
                <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Inactive
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 mb-3">Connected and ready to use</p>
              <Button variant="outline" size="sm" className="w-full">
                Configure
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
