import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { TrendingUp, Users, DollarSign, Target } from 'lucide-react'
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
      <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-widest ${isReal ? 'text-green-600 border-green-600/20 bg-green-500/5' : 'text-amber-600 border-amber-600/20 bg-amber-500/5'}`}>
        {isReal ? 'Real' : 'Parcial'}
      </span>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card className="hover:shadow-xl transition-all duration-500 group border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Meta Performance</CardTitle>
            {renderIsReal(quality?.metaIsReal)}
          </div>
          <div className="bg-primary/5 p-3 rounded-2xl group-hover:bg-primary/10 transition-colors duration-500">
            <Users className="h-5 w-5 text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3 mt-4">
            <div className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">
              {metrics.metaConversions.toLocaleString('es-ES')}
            </div>
            {metrics.deltas && <MetricDelta value={metrics.deltas.conversions} />}
          </div>
          <div className="mt-4">
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-wider italic">Leads Atribuidos</p>
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-xl transition-all duration-500 group border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">CRM Pipeline</CardTitle>
            {renderIsReal(quality?.crmIsReal)}
          </div>
          <div className="bg-primary/5 p-3 rounded-2xl group-hover:bg-primary/10 transition-colors duration-500">
            <Target className="h-5 w-5 text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3 mt-4">
            <div className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">
              {metrics.totalLeads.toLocaleString('es-ES')}
            </div>
            {metrics.deltas && <MetricDelta value={metrics.deltas.leads} />}
          </div>
          <div className="mt-4">
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-wider italic">Leads en BD</p>
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-xl transition-all duration-500 group border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Ingresos Reales</CardTitle>
            {renderIsReal(quality?.doctoraliaIsReal)}
          </div>
          <div className="bg-primary/5 p-3 rounded-2xl group-hover:bg-primary/10 transition-colors duration-500">
            <DollarSign className="h-5 w-5 text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3 mt-4">
            <div className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">
              €{metrics.verifiedRevenue?.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            {metrics.deltas && <MetricDelta value={metrics.deltas.revenue} />}
          </div>
          <div className="mt-4">
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-wider italic">Doctoralia Verificado</p>
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-xl transition-all duration-500 group border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Tasa de Cierre</CardTitle>
            {renderIsReal(quality?.doctoraliaIsReal)}
          </div>
          <div className="bg-primary/5 p-3 rounded-2xl group-hover:bg-primary/10 transition-colors duration-500">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-serif font-bold tracking-tight text-[#2C2825] mt-4">
            {metrics.conversionRate.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%
          </div>
          <div className="mt-4">
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-wider italic">Lead → Venta</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
