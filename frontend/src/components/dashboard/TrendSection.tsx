import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { TrendingUp } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MetaTrendPoint } from '../../types'

interface TrendSectionProps {
  readonly trendData: MetaTrendPoint[]
  readonly formatDate: (d: string) => string
}

export function TrendSection({ trendData, formatDate }: TrendSectionProps) {
  return (
    <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-md bg-white overflow-hidden group">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/10 pb-6">
        <CardTitle className="flex items-center gap-3 font-serif text-2xl text-[#2C2825]">
          <TrendingUp className="h-6 w-6 text-primary group-hover:scale-110 transition-transform duration-500" />
          Tendencia de Inversión
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-10">
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#A88B72" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#A88B72" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0EBE6" />
              <XAxis 
                dataKey="week" 
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#8E8680', fontSize: 10, fontWeight: 700 }}
                dy={10}
                tickFormatter={formatDate}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#8E8680', fontSize: 10, fontWeight: 700 }}
                tickFormatter={(val) => `€${val}`}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#FFFFFF', 
                  borderRadius: '16px', 
                  border: 'none',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                  padding: '12px'
                }}
                itemStyle={{ color: '#2C2825', fontSize: '12px', fontWeight: 700 }}
                labelStyle={{ color: '#8E8680', fontSize: '10px', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}
                formatter={(val: number) => [`€${val.toLocaleString('es-ES')}`, 'Inversión']}
                labelFormatter={formatDate}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#A88B72"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorValue)"
                animationDuration={2000}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
