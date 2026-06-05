import { Filter, Calendar, MapPin, Target } from 'lucide-react'
import DataModeBadge from '../ui/DataModeBadge'
import { MetaAccountsInline } from '../MetaAccountsNotice'

interface DashboardHeaderProps {
  readonly dataMode: string | undefined
  readonly sourceFilter: string
  readonly setSourceFilter: (v: string) => void
  readonly sourcesList: string[]
  readonly campaignId: string
  readonly setCampaignId: (v: string) => void
  readonly campaignsList: { id: string, name: string }[]
  readonly days: number
  readonly setDays: (v: 7 | 14 | 30 | 90) => void
  readonly customFrom: string
  readonly setCustomFrom: (v: string) => void
  readonly customTo: string
  readonly setCustomTo: (v: string | ((prev: string) => string)) => void
  readonly metaAccountIds: string[]
}

export function DashboardHeader({
  dataMode,
  sourceFilter,
  setSourceFilter,
  sourcesList,
  campaignId,
  setCampaignId,
  campaignsList,
  days,
  setDays,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  metaAccountIds,
}: DashboardHeaderProps) {
  const controlTextClass = 'text-[#5C5550] font-bold uppercase'
  const selectClass = 'bg-transparent border-none focus:ring-0 text-[10px] font-bold uppercase tracking-wider px-4 py-2 cursor-pointer outline-none appearance-none'
  const dateInputClass = 'bg-transparent border-none focus:ring-0 text-[10px] font-bold uppercase w-28 text-center outline-none cursor-pointer'

  return (
    <div className="flex flex-col space-y-10 mb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="space-y-4">
          <div className="flex items-center gap-6">
            <h1 id="dashboard-title" className="text-6xl font-serif font-bold tracking-tight text-[#2C2825] drop-shadow-sm">Dashboard</h1>
            <div className="mt-2">
              <DataModeBadge overallMode={dataMode as any} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-[2px] w-12 bg-[#B08B5A]/30" />
            <p className={`${controlTextClass} text-[11px] tracking-[0.25em] text-[#84643B]`}>Control de rendimiento médico</p>
          </div>
          <MetaAccountsInline
            accountIds={metaAccountIds || []}
            context="Dashboard consolidado de inversión, campañas y leads atribuidos."
            className="max-w-2xl bg-white/40 border-none shadow-none p-0"
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 bg-white/80 backdrop-blur-xl p-2 rounded-[1.25rem] border border-[#E5D5C5]/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            {([7, 14, 30, 90] as const).map((d) => (
              <button
                type="button"
                key={d}
                onClick={() => { setDays(d); setCustomFrom(''); setCustomTo('') }}
                className={`px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase transition-all duration-300 ${
                  !customFrom && days === d
                    ? 'bg-[#84643B] text-white shadow-[0_4px_12px_rgba(132,100,59,0.3)]'
                    : 'text-[#8E8680] hover:text-[#84643B] hover:bg-[#84643B]/5'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 items-center justify-between bg-white/30 backdrop-blur-2xl p-8 rounded-[2.5rem] border border-[#E5D5C5]/40 shadow-[0_20px_50px_rgba(176,139,90,0.05)]">
        <div className="flex flex-wrap items-center gap-6">
          {(sourcesList.length > 0 || campaignsList.length > 0) && (
            <div className="flex items-center gap-1 bg-white/90 p-2 rounded-2xl border border-[#E5D5C5]/60 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
              {sourcesList.length > 0 && (
                <div className="flex items-center border-r border-[#E5D5C5]/40 pr-2">
                  <MapPin className="w-3.5 h-3.5 ml-3 text-[#B08B5A]" />
                  <select
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    className={selectClass}
                  >
                    <option value="ALL">Todas las fuentes</option>
                    {sourcesList.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}
              {campaignsList.length > 0 && (
                <div className="flex items-center">
                  <Target className="w-3.5 h-3.5 ml-3 text-[#B08B5A]" />
                  <select
                    value={campaignId}
                    onChange={(e) => setCampaignId(e.target.value)}
                    className={selectClass}
                  >
                    <option value="ALL">Todas las campañas</option>
                    {campaignsList.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <div className="flex items-center gap-3 bg-white/90 p-2.5 rounded-2xl border border-[#E5D5C5]/60 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
            <Calendar className="w-3.5 h-3.5 ml-2 text-[#B08B5A]" />
            <div className="flex items-center">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => {
                  setCustomFrom(e.target.value)
                  setCustomTo((prev) => prev || new Date().toISOString().slice(0, 10))
                }}
                className={dateInputClass}
              />
              <span className="text-[#8E8680] text-[10px] font-bold mx-2">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className={dateInputClass}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
