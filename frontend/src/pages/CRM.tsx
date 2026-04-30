import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

export default function CRM() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">CRM</h1>
        <p className="text-slate-600 mt-1">Lead pipeline — stages, DNI, lost_reason</p>
      </div>

      <Tabs defaultValue="pipeline" className="w-full">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="stages">Stages</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {['New', 'Contacted', 'Qualified', 'Closed'].map((stage) => (
              <Card key={stage}>
                <CardHeader>
                  <CardTitle className="text-base">{stage}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">0</p>
                  <p className="text-xs text-slate-500 mt-1">Leads in stage</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leads">
          <Card>
            <CardHeader>
              <CardTitle>All Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600">Fetching leads from Edge Function...</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stages">
          <Card>
            <CardHeader>
              <CardTitle>Stage Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600">Manage lead pipeline stages and transitions.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
