import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { TrendingUp, Users, DollarSign, Target, Sparkles } from 'lucide-react'
import { MetricDelta } from './MetricDelta'
import type { DashboardMetrics } from '../../types'
import type { DashboardQuality } from '../../lib/dashboard-helpers'

interface MetricsGridProps {
  readonly metrics: DashboardMetrics
  readonly quality: DashboardQuality | null
}

export function MetricsGrid({ metrics, quality }: MetricsGridProps) {
  const renderIsReal = (isReal: boolean | undefined) => {
    if (isReal === undefined) return null;
    return (
      <span className={`text-[9px] px-2.5 py-1 rounded-full border font-bold uppercase tracking-[0.15em] ${isReal ? 'text-[#28A745] border-[#28A745]/20 bg-[#28A745]/5' : 'text-[#B08B5A] border-[#B08B5A]/20 bg-[#B08B5A]/5'}`}>
        {isReal ? 'Dato Real' : 'Dato Parcial'}
      </span>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
      <Card className="hover:shadow-[0_20px_40px_rgba(0,0,0,0.06)] transition-all duration-700 group border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] bg-white/80 backdrop-blur-sm rounded-[2rem] overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-10 transition-opacity duration-700">
          <Sparkles className="h-20 w-20 text-[#B08B5A]" />
        </div>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 relative z-10">
          <div className="flex flex-col gap-3">
            <CardTitle className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.25em]">Meta Performance</CardTitle>
            {renderIsReal(quality?.metaIsReal)}
          </div>
          <div className="bg-[#FAF7F2] p-3.5 rounded-2xl group-hover:bg-[#B08B5A] transition-all duration-500 group-hover:rotate-12">
            <Users className="h-5 w-5 text-[#B08B5A] group-hover:text-white" />
          </div>
        </CardHeader>
        <CardContent className="relative z-10">
          <div className="flex items-baseline gap-4 mt-6">
            <div className="text-5xl font-serif font-bold tracking-tight text-[#2C2825]">
              {metrics.metaConversions.toLocaleString('es-ES')}
            </div>
            {metrics.deltas && <MetricDelta value={metrics.deltas.conversions} />}
          </div>
          <div className="mt-6 flex items-center gap-2">
            <div className="h-[1px] w-4 bg-[#B08B5A]/40" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest">Leads Atribuidos</p>
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-[0_20px_40px_rgba(0,0,0,0.06)] transition-all duration-700 group border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] bg-white/80 backdrop-blur-sm rounded-[2rem] overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-10 transition-opacity duration-700">
          <Sparkles className="h-20 w-20 text-[#B08B5A]" />
        </div>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 relative z-10">
          <div className="flex flex-col gap-3">
            <CardTitle className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.25em]">CRM Pipeline</CardTitle>
            {renderIsReal(quality?.crmIsReal)}
          </div>
          <div className="bg-[#FAF7F2] p-3.5 rounded-2xl group-hover:bg-[#B08B5A] transition-all duration-500 group-hover:-rotate-12">
            <Target className="h-5 w-5 text-[#B08B5A] group-hover:text-white" />
          </div>
        </CardHeader>
        <CardContent className="relative z-10">
          <div className="flex items-baseline gap-4 mt-6">
            <div className="text-5xl font-serif font-bold tracking-tight text-[#2C2825]">
              {metrics.totalLeads.toLocaleString('es-ES')}
            </div>
            {metrics.deltas && <MetricDelta value={metrics.deltas.leads} />}
          </div>
          <div className="mt-6 flex items-center gap-2">
            <div className="h-[1px] w-4 bg-[#B08B5A]/40" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest">Leads en BD</p>
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-[0_20px_40px_rgba(0,0,0,0.06)] transition-all duration-700 group border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] bg-white/80 backdrop-blur-sm rounded-[2rem] overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-10 transition-opacity duration-700">
          <Sparkles className="h-20 w-20 text-[#B08B5A]" />
        </div>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 relative z-10">
          <div className="flex flex-col gap-3">
            <CardTitle className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.25em]">Ingresos Reales</CardTitle>
            {renderIsReal(quality?.doctoraliaIsReal)}
          </div>
          <div className="bg-[#FAF7F2] p-3.5 rounded-2xl group-hover:bg-[#B08B5A] transition-all duration-500 group-hover:scale-110">
            <DollarSign className="h-5 w-5 text-[#B08B5A] group-hover:text-white" />
          </div>
        </CardHeader>
        <CardContent className="relative z-10">
          <div className="flex items-baseline gap-4 mt-6">
            <div className="text-5xl font-serif font-bold tracking-tight text-[#2C2825]">
              {`€${metrics.verifiedRevenue.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            </div>
            {metrics.deltas && <MetricDelta value={metrics.deltas.revenue} />}
          </div>
          <div className="mt-6 flex items-center gap-2">
            <div className="h-[1px] w-4 bg-[#B08B5A]/40" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest">Doctoralia Verificado</p>
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-[0_20px_40px_rgba(0,0,0,0.06)] transition-all duration-700 group border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] bg-white/80 backdrop-blur-sm rounded-[2rem] overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-10 transition-opacity duration-700">
          <Sparkles className="h-20 w-20 text-[#B08B5A]" />
        </div>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 relative z-10">
          <div className="flex flex-col gap-3">
            <CardTitle className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.25em]">Tasa de Cierre</CardTitle>
            {renderIsReal(quality?.doctoraliaIsReal)}
          </div>
          <div className="bg-[#FAF7F2] p-3.5 rounded-2xl group-hover:bg-[#B08B5A] transition-all duration-500 group-hover:translate-y-[-4px]">
            <TrendingUp className="h-5 w-5 text-[#B08B5A] group-hover:text-white" />
          </div>
        </CardHeader>
        <CardContent className="relative z-10">
          <div className="text-5xl font-serif font-bold tracking-tight text-[#2C2825] mt-6">
            {`${metrics.conversionRate.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`}
          </div>
          <div className="mt-6 flex items-center gap-2">
            <div className="h-[1px] w-4 bg-[#B08B5A]/40" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest">Lead → Venta</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
