import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Target, ShieldCheck, Wallet, UserCheck } from 'lucide-react'
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
            <div className="bg-[#FAF7F2] p-3 rounded-2xl"><ShieldCheck className="h-6 w-6 text-[#B08B5A]" /></div>
            Eficiencia operativa
          </CardTitle>
          <p className="text-xs text-[#8E8680] mt-2">CAC y ROAS quedan bloqueados hasta disponer de atribución financiera temporalmente reconciliada por lead/campaña.</p>
        </div>
      </CardHeader>
      <CardContent className="pt-10 px-8 pb-10 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="space-y-5 group">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">Inversión Meta</span>
              <div className="p-2.5 bg-[#FAF7F2] rounded-xl group-hover:bg-[#B08B5A] transition-all duration-500"><Wallet className="h-3.5 w-3.5 text-[#B08B5A] group-hover:text-white" /></div>
            </div>
            <p className="text-4xl font-serif font-bold text-[#2C2825]">{formatCurrency(funnel.metaSpend)}</p>
            <div className="h-[2px] w-6 bg-[#B08B5A]/20 group-hover:w-10 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">Gasto reportado por Meta</p>
          </div>

          <div className="space-y-5 group">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">Identidades Doctoralia</span>
              <div className="p-2.5 bg-[#FAF7F2] rounded-xl group-hover:bg-[#B08B5A] transition-all duration-500"><UserCheck className="h-3.5 w-3.5 text-[#B08B5A] group-hover:text-white" /></div>
            </div>
            <p className="text-4xl font-serif font-bold text-[#2C2825]">{funnel.doctoraliaPatients ?? '—'}</p>
            <div className="h-[2px] w-6 bg-[#B08B5A]/20 group-hover:w-10 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">Cruce de identidad, no conversión</p>
          </div>

          <div className="space-y-5 group">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">CAC cliente nuevo</span>
              <div className="p-2.5 bg-[#FAF7F2] rounded-xl group-hover:bg-[#B08B5A] transition-all duration-500"><Target className="h-3.5 w-3.5 text-[#B08B5A] group-hover:text-white" /></div>
            </div>
            <p className="text-4xl font-serif font-bold text-[#2C2825]">—</p>
            <div className="h-[2px] w-6 bg-[#B08B5A]/20 group-hover:w-10 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">No disponible · attribution pendiente</p>
          </div>

          <div className="space-y-5 group">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#8E8680] uppercase tracking-[0.2em] group-hover:text-[#84643B] transition-colors">Coste / conversión Meta</span>
              <div className="p-2.5 bg-[#FAF7F2] rounded-xl group-hover:bg-[#B08B5A] transition-all duration-500"><Target className="h-3.5 w-3.5 text-[#B08B5A] group-hover:text-white" /></div>
            </div>
            <p className="text-4xl font-serif font-bold text-[#2C2825]">{formatCurrency(combined.metaCpl)}</p>
            <div className="h-[2px] w-6 bg-[#B08B5A]/20 group-hover:w-10 transition-all duration-500" />
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest opacity-60">Meta spend / conversiones Meta</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
