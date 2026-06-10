import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Target, TrendingUp, ShieldCheck, Wallet, UserCheck } from 'lucide-react'
import type { RealFunnel, CombinedMetrics } from '../../lib/dashboard-helpers'

interface RealROISectionProps {
  readonly funnel: RealFunnel | null
  readonly combined: CombinedMetrics
}

function formatCurrency(value: number | null | undefined) {
  return value != null ? `€${value.toLocaleString('es-ES')}` : '—'
}

export function RealROISection({ funnel, combined }: RealROISectionProps) {
  if (!funnel) return null

  return (
    <Card className="border-none shadow-[0_8px_30px_rgba(0,0,0,0.02)] overflow-hidden relative transition-all duration-700 bg-white/80 backdrop-blur-md rounded-[2.5rem] hover:shadow-[0_20px_50px_rgba(0,0,0,0.04)]">
      <div className="absolute top-0 left-0 w-64 h-64 bg-[#B08B5A]/5 rounded-full -ml-32 -mt-32 blur-3xl" />
      <CardHeader className="flex flex-row items-center justify-between border-b border-[#E5D5C5]/20 pb-8 px-8 pt-8 relative z-10">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-4 font-serif text-3xl text-[#2C2825]">
            <div className="bg-[#FAF7F2] p-3 rounded-2xl">
              <ShieldCheck className="h-6 w-6 text-[#B08B5A]" />
            </div>
            Eficiencia operativa y caja
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-10 px-8 pb-10 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="space-y-5 group">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">Inversión Meta</span>
              <div className="p-2.5 bg-[#FAF7F2] rounded-xl group-hover:bg-[#B08B5A] transition-all duration-500">
                <Wallet className="h-3.5 w-3.5 text-[#B08B5A] group-hover:text-white" />
              </div>
            </div>
            <p className="text-4xl font-serif font-bold text-[#2C2825]">{formatCurrency(funnel.metaSpend)}</p>
            <div className="h-[2px] w-6 bg-[#B08B5A]/20 group-hover:w-10 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">Gasto total publicidad</p>
          </div>

          <div className="space-y-5 group">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">Pacientes cruzados</span>
              <div className="p-2.5 bg-[#FAF7F2] rounded-xl group-hover:bg-[#B08B5A] transition-all duration-500">
                <UserCheck className="h-3.5 w-3.5 text-[#B08B5A] group-hover:text-white" />
              </div>
            </div>
            <p className="text-4xl font-serif font-bold text-[#2C2825]">{funnel.doctoraliaPatients ?? '—'}</p>
            <div className="h-[2px] w-6 bg-[#B08B5A]/20 group-hover:w-10 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">Coincidencia por identidad</p>
          </div>

          <div className="space-y-5 group">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">Coste por paciente cruzado</span>
              <div className="p-2.5 bg-[#FAF7F2] rounded-xl group-hover:bg-[#B08B5A] transition-all duration-500">
                <Target className="h-3.5 w-3.5 text-[#B08B5A] group-hover:text-white" />
              </div>
            </div>
            <p className="text-4xl font-serif font-bold text-[#2C2825]">{formatCurrency(funnel.cac)}</p>
            <div className="h-[2px] w-6 bg-[#B08B5A]/20 group-hover:w-10 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">Meta spend / pacientes cruzados</p>
          </div>

          <div className="space-y-5 group">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">Ingreso x Lead</span>
              <div className="p-2.5 bg-[#FAF7F2] rounded-xl group-hover:bg-[#B08B5A] transition-all duration-500">
                <TrendingUp className="h-3.5 w-3.5 text-[#B08B5A] group-hover:text-white" />
              </div>
            </div>
            <p className="text-4xl font-serif font-bold text-[#2C2825]">{formatCurrency(combined.revenuePerLead)}</p>
            <div className="h-[2px] w-6 bg-[#B08B5A]/20 group-hover:w-10 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">Caja liquidada / leads CRM</p>
          </div>
        </div>

        {funnel.cacConfidence != null && (
          <div className="mt-12 pt-8 border-t border-[#E5D5C5]/20 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-6 w-full sm:w-auto">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#B08B5A]/5 rounded-lg">
                  <ShieldCheck className="h-4 w-4 text-[#B08B5A]" />
                </div>
                <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em]">Confianza del cruce</span>
              </div>
              <div className="flex-1 sm:w-48 h-2 bg-[#FAF7F2] rounded-full overflow-hidden border border-[#E5D5C5]/40 shadow-inner min-w-[120px]">
                <div
                  className={`h-full transition-all duration-[2000ms] cubic-bezier(0.4, 0, 0.2, 1) ${
                    funnel.cacConfidence > 70 ? 'bg-[#28A745]' : funnel.cacConfidence > 40 ? 'bg-[#B08B5A]' : 'bg-[#D9534F]'
                  }`}
                  style={{ width: `${funnel.cacConfidence}%` }}
                />
              </div>
              <span className={`text-xs font-bold ${
                funnel.cacConfidence > 70 ? 'text-[#28A745]' : funnel.cacConfidence > 40 ? 'text-[#B08B5A]' : 'text-[#D9534F]'
              }`}>{funnel.cacConfidence}%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-[#28A745] animate-pulse" />
              <p className="text-[10px] font-bold text-[#8E8680] uppercase tracking-widest">Datos sincronizados</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
