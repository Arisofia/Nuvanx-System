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
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#4f3d27" />
          <XAxis type="number" hide />
          <YAxis
            dataKey="label"
            type="category"
            tick={{ fill: '#a38f79', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
            contentStyle={{ backgroundColor: '#17120f', border: '1px solid #4f3d27' }}
            itemStyle={{ color: '#f7efe6' }}
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
