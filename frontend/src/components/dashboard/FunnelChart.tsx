import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts'

interface FunnelData {
  stage: string
  label: string
  count: number
  percentage: number
}

interface FunnelChartProps {
  data: FunnelData[]
}

const STAGE_COLORS: Record<string, string> = {
  lead: '#c9a471',
  whatsapp: '#d4b37d',
  appointment: '#b08b5a',
  treatment: '#8ee0b8',
  closed: '#a38f79',
}

export function FunnelChart({ data }: FunnelChartProps) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E6E2DE" />
          <XAxis type="number" hide />
          <YAxis
            dataKey="label"
            type="category"
            tick={{ fill: '#7A7573', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
            contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E2DE' }}
            itemStyle={{ color: '#2E2A28' }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={STAGE_COLORS[entry.stage] || '#c9a471'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
