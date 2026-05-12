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
  const selectClass = 'bg-transparent border-none focus:ring-0 text-[10px] font-bold uppercase tracking-wider px-4 py-2 cursor-pointer'
  const dateInputClass = 'bg-transparent border-none focus:ring-0 text-[10px] font-bold uppercase w-28 text-center'

  return (
    <div className="flex flex-col space-y-8 mb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <h1 id="dashboard-title" className="text-5xl font-serif font-bold tracking-tight text-[#2C2825]">Dashboard</h1>
            <DataModeBadge overallMode={dataMode as any} />
          </div>
          <p className={`${controlTextClass} text-xs tracking-wide`}>Control de rendimiento médico</p>
          <MetaAccountsInline
            accountIds={metaAccountIds}
            context="Dashboard consolidado de inversión, campañas y leads atribuidos."
            className="max-w-2xl bg-white/60"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white/60 backdrop-blur-md p-1.5 rounded-2xl border border-border/40 shadow-sm">
            {([7, 14, 30, 90] as const).map((d) => (
              <button
                type="button"
                key={d}
                onClick={() => { setDays(d); setCustomFrom(''); setCustomTo('') }}
                className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${
                  !customFrom && days === d
                    ? 'bg-primary text-white shadow-md'
                    : 'text-[#8E8680] hover:text-primary hover:bg-primary/5'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full flex flex-col lg:flex-row items-center justify-between gap-6 bg-white/40 backdrop-blur-md p-6 rounded-[2rem] border border-border/40 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          {(sourcesList.length > 0 || campaignsList.length > 0) && (
            <div className="flex items-center gap-2 bg-white/80 p-1.5 rounded-2xl border border-border/60 shadow-inner">
              {sourcesList.length > 0 && (
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className={selectClass + ' border-r border-border/40'}
                >
                  <option value="ALL">Todas las fuentes</option>
                  {sourcesList.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
              {campaignsList.length > 0 && (
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
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 bg-white/80 p-2 rounded-2xl border border-border/60 shadow-inner">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => {
              setCustomFrom(e.target.value)
              setCustomTo((prev) => prev || new Date().toISOString().slice(0, 10))
            }}
            className={dateInputClass}
          />
          <span className="text-[#8E8680] text-xs">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className={dateInputClass}
          />
        </div>
      </div>
    </div>
  )
}
