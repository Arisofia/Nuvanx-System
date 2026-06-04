import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { TrendingUp, DollarSign, Users, Target, ArrowUpRight, BarChart3, AlertCircle } from 'lucide-react'
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
      <Card className="hover:shadow-[0_20px_50px_rgba(0,0,0,0.04)] transition-all duration-700 border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] bg-white/80 backdrop-blur-md rounded-[2.5rem] overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#B08B5A]/5 rounded-full -mr-32 -mt-32 blur-3xl" />
        <CardHeader className="flex flex-row items-center justify-between border-b border-[#E5D5C5]/20 pb-8 px-8 pt-8 relative z-10">
          <CardTitle className="flex items-center gap-4 font-serif text-3xl text-[#2C2825]">
            <div className="bg-[#FAF7F2] p-3 rounded-2xl">
              <BarChart3 className="h-6 w-6 text-[#B08B5A]" />
            </div>
            Lead Funnel
          </CardTitle>
          <div className="flex flex-col items-end">
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-[0.2em] italic opacity-60">Distribución por etapa</p>
          </div>
        </CardHeader>
        <CardContent className="pt-12 px-8 relative z-10 pb-12">
          <FunnelChart data={funnelData} />
        </CardContent>
      </Card>

      <Card className="hover:shadow-[0_20px_50px_rgba(0,0,0,0.04)] transition-all duration-700 border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] bg-white/80 backdrop-blur-md rounded-[2.5rem] overflow-hidden relative">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-8 px-8 pt-8 border-b border-[#E5D5C5]/20 relative z-10">
          <CardTitle className="flex items-center gap-4 font-serif text-3xl text-[#2C2825]">
            <div className="bg-[#FAF7F2] p-3 rounded-2xl">
              <DollarSign className="h-6 w-6 text-[#B08B5A]" />
            </div>
            Meta Analytics
          </CardTitle>
          {quality?.metaDataSource && (
            <span className="text-[9px] font-bold text-[#B08B5A] uppercase bg-[#B08B5A]/10 px-4 py-2 rounded-full border border-[#B08B5A]/20 tracking-[0.2em] backdrop-blur-sm">
              {quality.metaDataSource.replace('_', ' ')}
            </span>
          )}
        </CardHeader>
        <CardContent className="pt-8 px-8 relative z-10 grid grid-cols-1 sm:grid-cols-2 gap-6 pb-12">
          <div className="sm:col-span-2 rounded-2xl border border-amber-200 bg-amber-50/50 px-5 py-4 flex gap-4 items-start">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-800">Estado de atribución</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-amber-900/80 font-medium">
                Datos no aptos para decisiones de presupuesto, CAC, CPL ni validación CAPI. Uso permitido solo para monitoreo interno de gasto Meta (Goya) y volumen bruto de leads CRM.
              </p>
            </div>
          </div>

          <div className="bg-white/60 p-6 rounded-[2rem] border border-[#E5D5C5]/40 hover:border-[#B08B5A]/30 transition-all duration-500 hover:shadow-xl hover:shadow-[#B08B5A]/5 group relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <DollarSign className="h-12 w-12 text-[#B08B5A]" />
            </div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">Inversión Meta</span>
              <DollarSign className="h-4 w-4 text-[#B08B5A] opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">€{(metrics.spend ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
            <div className="h-[2px] w-8 bg-[#B08B5A]/20 my-5 group-hover:w-12 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">{periodLabel}</p>
          </div>
          
          <div className="bg-white/60 p-6 rounded-[2rem] border border-[#E5D5C5]/40 hover:border-[#B08B5A]/30 transition-all duration-500 hover:shadow-xl hover:shadow-[#B08B5A]/5 group relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Users className="h-12 w-12 text-[#B08B5A]" />
            </div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">Conversiones Meta</span>
              <Users className="h-4 w-4 text-[#B08B5A] opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">{(combined.metaEstimatedLeads ?? 0).toLocaleString('es-ES')}</p>
            <div className="h-[2px] w-8 bg-[#B08B5A]/20 my-5 group-hover:w-12 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">Campo Conversions</p>
          </div>

          <div className="bg-white/60 p-6 rounded-[2rem] border border-[#E5D5C5]/40 hover:border-[#B08B5A]/30 transition-all duration-500 hover:shadow-xl hover:shadow-[#B08B5A]/5 group relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Target className="h-12 w-12 text-[#B08B5A]" />
            </div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">Costo / Conversión</span>
              <Target className="h-4 w-4 text-[#B08B5A] opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">
              {combined.metaCpl ? `€${combined.metaCpl.toLocaleString('es-ES')}` : '0'}
            </p>
            <div className="h-[2px] w-8 bg-[#B08B5A]/20 my-5 group-hover:w-12 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">Indicador Bruto</p>
          </div>

          <div className="bg-white/60 p-6 rounded-[2rem] border border-[#E5D5C5]/40 hover:border-[#B08B5A]/30 transition-all duration-500 hover:shadow-xl hover:shadow-[#B08B5A]/5 group relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <ArrowUpRight className="h-12 w-12 text-[#B08B5A]" />
            </div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">CPC Medio</span>
              <ArrowUpRight className="h-4 w-4 text-[#B08B5A] opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">€{(metrics.averageCpc ?? 0).toLocaleString('es-ES')}</p>
            <div className="h-[2px] w-8 bg-[#B08B5A]/20 my-5 group-hover:w-12 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">Coste por Click</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
