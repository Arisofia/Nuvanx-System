import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Target, TrendingUp, AlertCircle, Percent } from 'lucide-react'
import type { RealFunnel, CombinedMetrics } from '../../lib/dashboard-helpers'

interface RealROISectionProps {
  readonly funnel: RealFunnel | null
  readonly combined: CombinedMetrics
  readonly isFunnelDemo: boolean
}

export function RealROISection({ funnel, combined, isFunnelDemo }: RealROISectionProps) {
  if (!funnel) return null

  return (
    <Card className={`border-none shadow-md overflow-hidden relative transition-all duration-500 ${isFunnelDemo ? 'bg-amber-50/30' : 'bg-white'}`}>
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/10 pb-6">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-3 font-serif text-2xl text-[#2C2825]">
            <Target className="h-6 w-6 text-primary" />
            Atribución y ROI Real
          </CardTitle>
          {isFunnelDemo && (
            <div className="flex items-center gap-2 text-[10px] font-bold text-amber-600 uppercase tracking-widest bg-amber-500/5 px-3 py-1 rounded-full border border-amber-500/10">
              <AlertCircle className="h-3 w-3" />
              Vista de demostración: No hay pacientes verificados para este periodo
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Inversión Meta</span>
              <div className="p-2 bg-primary/5 rounded-xl">
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
              </div>
            </div>
            <p className="text-3xl font-serif font-bold text-[#2C2825]">€{funnel.metaSpend.toLocaleString('es-ES')}</p>
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">Gasto total en publicidad</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Pacientes Reales</span>
              <div className="p-2 bg-primary/5 rounded-xl">
                <Percent className="h-3.5 w-3.5 text-primary" />
              </div>
            </div>
            <p className="text-3xl font-serif font-bold text-[#2C2825]">{funnel.doctoraliaPatients}</p>
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">Cruzados por DNI/Nombre/Tel</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">CAC Real (Doctoralia)</span>
              <div className="p-2 bg-primary/5 rounded-xl">
                <Target className="h-3.5 w-3.5 text-primary" />
              </div>
            </div>
            <p className="text-3xl font-serif font-bold text-[#2C2825]">
              {funnel.cac != null ? `€${funnel.cac.toLocaleString('es-ES')}` : '0'}
            </p>
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">Coste Adquisición Paciente</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Ingreso x Lead</span>
              <div className="p-2 bg-primary/5 rounded-xl">
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
              </div>
            </div>
            <p className="text-3xl font-serif font-bold text-[#2C2825]">
              {combined.revenuePerLead != null ? `€${combined.revenuePerLead.toLocaleString('es-ES')}` : '0'}
            </p>
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">Ticket medio por adquisición</p>
          </div>
        </div>

        {funnel.cacConfidence != null && (
          <div className="mt-8 pt-6 border-t border-border/10 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Confianza en Atribución</span>
              <div className="w-32 h-1.5 bg-[#FAF7F2] rounded-full overflow-hidden border border-border/40">
                <div 
                  className={`h-full transition-all duration-1000 ${
                    Number(funnel.cacConfidence) > 70 ? 'bg-green-500' : Number(funnel.cacConfidence) > 40 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${funnel.cacConfidence}%` }}
                />
              </div>
              <span className="text-[10px] font-bold text-primary">{funnel.cacConfidence}%</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
