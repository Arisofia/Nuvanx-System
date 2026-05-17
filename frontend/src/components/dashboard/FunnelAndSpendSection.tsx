import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { TrendingUp, DollarSign, Users, Target } from 'lucide-react'
import { FunnelChart } from './FunnelChart'
import type { DashboardMetrics } from '../../types'
import type { CombinedMetrics, DashboardQuality } from '../../lib/dashboard-helpers'

interface FunnelAndSpendSectionProps {
  readonly funnelData: any[]
  readonly metrics: DashboardMetrics
  readonly combined: CombinedMetrics
  readonly periodLabel: string
  readonly quality: DashboardQuality | null
}

export function FunnelAndSpendSection({
  funnelData,
  metrics,
  combined,
  periodLabel,
  quality,
}: FunnelAndSpendSectionProps) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
      <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-md bg-white overflow-hidden relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl" />
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/10 pb-6 relative">
          <CardTitle className="flex items-center gap-3 font-serif text-2xl text-[#2C2825]">
            <TrendingUp className="h-6 w-6 text-primary" />
            Lead Funnel
          </CardTitle>
          <div className="flex flex-col items-end">
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest italic opacity-60">Distribución por etapa</p>
          </div>
        </CardHeader>
        <CardContent className="pt-10">
          <FunnelChart data={funnelData} />
        </CardContent>
      </Card>

      <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-md bg-white overflow-hidden relative">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6 border-b border-border/10">
          <CardTitle className="flex items-center gap-3 font-serif text-2xl text-[#2C2825]">
            <DollarSign className="h-6 w-6 text-primary" />
            Meta Analytics
          </CardTitle>
          {quality?.metaDataSource && (
            <span className="text-[9px] font-bold text-primary/60 uppercase bg-primary/5 px-3 py-1.5 rounded-full border border-primary/10 tracking-[0.2em]">
              {quality.metaDataSource.replace('_', ' ')}
            </span>
          )}
        </CardHeader>
        <CardContent className="pt-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-[#FAF7F2]/60 p-6 rounded-3xl border border-border/40 hover:border-primary/30 transition-all duration-500 hover:shadow-lg hover:shadow-primary/5 group">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em] group-hover:text-primary transition-colors">Inversión Meta</span>
              <DollarSign className="h-4 w-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">€{metrics.spend.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
            <div className="h-[1px] w-8 bg-primary/20 my-4" />
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">{periodLabel}</p>
          </div>
          
          <div className="bg-[#FAF7F2]/60 p-6 rounded-3xl border border-border/40 hover:border-primary/30 transition-all duration-500 hover:shadow-lg hover:shadow-primary/5 group">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em] group-hover:text-primary transition-colors">Leads Atribuidos</span>
              <Users className="h-4 w-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">{combined.metaEstimatedLeads.toLocaleString('es-ES')}</p>
            <div className="h-[1px] w-8 bg-primary/20 my-4" />
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">Meta Leads atribuidos</p>
          </div>

          <div className="bg-[#FAF7F2]/60 p-6 rounded-3xl border border-border/40 hover:border-primary/30 transition-all duration-500 hover:shadow-lg hover:shadow-primary/5 group">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em] group-hover:text-primary transition-colors">CPL Meta</span>
              <Target className="h-4 w-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">
              {combined.metaCpl ? `€${combined.metaCpl.toLocaleString('es-ES')}` : '0'}
            </p>
            <div className="h-[1px] w-8 bg-primary/20 my-4" />
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">Coste por Lead</p>
          </div>

          <div className="bg-[#FAF7F2]/60 p-6 rounded-3xl border border-border/40 hover:border-primary/30 transition-all duration-500 hover:shadow-lg hover:shadow-primary/5 group">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em] group-hover:text-primary transition-colors">CPC Medio</span>
              <ArrowUpRight className="h-4 w-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">€{metrics.averageCpc.toLocaleString('es-ES')}</p>
            <div className="h-[1px] w-8 bg-primary/20 my-4" />
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">Coste por Click</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ArrowUpRight(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  )
}
