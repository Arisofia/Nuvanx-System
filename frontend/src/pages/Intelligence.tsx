import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

export default function Intelligence() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Intelligence</h1>
        <p className="text-slate-600 mt-1">Campaign attribution, WhatsApp funnel, conversation log</p>
      </div>

      <Tabs defaultValue="attribution" className="w-full">
        <TabsList>
          <TabsTrigger value="attribution">Attribution</TabsTrigger>
          <TabsTrigger value="funnel">WhatsApp Funnel</TabsTrigger>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
        </TabsList>

        <TabsContent value="attribution">
          <Card>
            <CardHeader>
              <CardTitle>Multi-Touch Attribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-sm font-medium">Meta Lead Ads → WhatsApp → Appointment</p>
                  <p className="text-xs text-slate-500 mt-1">45% of conversions</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-sm font-medium">Google Ads → Landing Page → Lead</p>
                  <p className="text-xs text-slate-500 mt-1">35% of conversions</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-sm font-medium">Organic → Direct → Conversion</p>
                  <p className="text-xs text-slate-500 mt-1">20% of conversions</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnel">
          <Card>
            <CardHeader>
              <CardTitle>WhatsApp Conversion Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between items-center p-2 bg-blue-50 rounded">
                  <span>Messages Sent</span>
                  <span className="font-bold">1,234</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-blue-100 rounded">
                  <span>Messages Read</span>
                  <span className="font-bold">892 (72%)</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-blue-200 rounded">
                  <span>Replies</span>
                  <span className="font-bold">456 (51%)</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-blue-300 rounded">
                  <span>Appointments Scheduled</span>
                  <span className="font-bold">128 (28%)</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversations">
          <Card>
            <CardHeader>
              <CardTitle>Recent Conversations</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600">Fetching conversation logs from Edge Function...</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
