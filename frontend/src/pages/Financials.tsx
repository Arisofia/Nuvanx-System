import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const mockData = [
  { month: 'Jan', revenue: 4000, ltv: 2400, cac: 2210 },
  { month: 'Feb', revenue: 3000, ltv: 1398, cac: 2221 },
  { month: 'Mar', revenue: 2000, ltv: 9800, cac: 2290 },
  { month: 'Apr', revenue: 2780, ltv: 3908, cac: 2000 },
]

export default function Financials() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Verified Financials</h1>
        <p className="text-slate-600 mt-1">Doctoralia settlements, LTV, verified revenue</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Verified Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$24,580</div>
            <p className="text-xs text-slate-500 mt-1">From Doctoralia settlements</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Average LTV</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$1,240</div>
            <p className="text-xs text-slate-500 mt-1">Per customer lifetime</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">CAC</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$340</div>
            <p className="text-xs text-slate-500 mt-1">Cost per acquisition</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={mockData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#3b82f6" />
              <Line type="monotone" dataKey="ltv" stroke="#10b981" />
              <Line type="monotone" dataKey="cac" stroke="#ef4444" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
