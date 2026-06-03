import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { TrendingUp, LineChart as LineChartIcon } from 'lucide-react'
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
    <Card className="hover:shadow-[0_20px_50px_rgba(0,0,0,0.04)] transition-all duration-700 border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] bg-white/80 backdrop-blur-md rounded-[2.5rem] overflow-hidden group relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-[#B08B5A]/5 rounded-full -mr-32 -mt-32 blur-3xl" />
      <CardHeader className="flex flex-row items-center justify-between border-b border-[#E5D5C5]/20 pb-8 px-8 pt-8 relative z-10">
        <CardTitle className="flex items-center gap-4 font-serif text-3xl text-[#2C2825]">
          <div className="bg-[#FAF7F2] p-3 rounded-2xl group-hover:bg-[#B08B5A] transition-all duration-500">
            <LineChartIcon className="h-6 w-6 text-[#B08B5A] group-hover:text-white transition-colors" />
          </div>
          Tendencia de Inversión
        </CardTitle>
        <div className="flex flex-col items-end">
          <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-[0.2em] italic opacity-60">Histórico de gasto Meta</p>
        </div>
      </CardHeader>
      <CardContent className="pt-12 px-8 pb-12 relative z-10">
        <div className="h-[450px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#B08B5A" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#B08B5A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#E5D5C5" strokeOpacity={0.4} />
              <XAxis 
                dataKey="week" 
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#8E8680', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}
                dy={15}
                tickFormatter={formatDate}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#8E8680', fontSize: 10, fontWeight: 700 }}
                tickFormatter={(val) => `€${val}`}
                dx={-10}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                  borderRadius: '20px', 
                  border: '1px solid rgba(229, 213, 197, 0.4)',
                  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.08)',
                  padding: '16px',
                  backdropFilter: 'blur(10px)'
                }}
                itemStyle={{ color: '#2C2825', fontSize: '13px', fontWeight: 700, padding: '4px 0' }}
                labelStyle={{ color: '#B08B5A', fontSize: '10px', fontWeight: 800, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.15em' }}
                formatter={(val: number) => [`€${val.toLocaleString('es-ES')}`, 'Inversión']}
                labelFormatter={formatDate}
                cursor={{ stroke: '#B08B5A', strokeWidth: 2, strokeDasharray: '6 6' }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#B08B5A"
                strokeWidth={4}
                fillOpacity={1}
                fill="url(#colorValue)"
                animationDuration={2500}
                animationEasing="ease-in-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
