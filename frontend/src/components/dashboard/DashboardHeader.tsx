import { MapPin, Target } from 'lucide-react'
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
  readonly dateRange: { from: string; to: string }
  readonly setDateRange: (v: { from: string; to: string }) => void
  readonly metaAccountIds: string[]
}

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateLabel(dateValue: string) {
  const [year, month, day] = dateValue.split('-')
  return year && month && day ? `${day}/${month}/${year}` : dateValue
}

function calculateRangeDays(dateRange: { from: string; to: string }) {
  const from = new Date(`${dateRange.from}T00:00:00`).getTime()
  const to = new Date(`${dateRange.to}T00:00:00`).getTime()

  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return 0
  }

  return Math.max(1, Math.round((to - from) / 86_400_000) + 1)
}

export function DashboardHeader({
  dataMode,
  sourceFilter,
  setSourceFilter,
  sourcesList,
  campaignId,
  setCampaignId,
  campaignsList,
  dateRange,
  setDateRange,
  metaAccountIds,
}: DashboardHeaderProps) {
  const controlTextClass = 'text-[#5C5550] font-bold uppercase'
  const selectClass = 'bg-transparent border-none focus:ring-0 text-[10px] font-bold uppercase tracking-wider px-4 py-2 cursor-pointer outline-none appearance-none'
  const days = calculateRangeDays(dateRange)

  const setThisMonth = () => {
    const d = new Date()
    setDateRange({
      from: toLocalDateInputValue(new Date(d.getFullYear(), d.getMonth(), 1)),
      to: toLocalDateInputValue(d)
    })
  }

  const setLastMonth = () => {
    const d = new Date()
    setDateRange({
      from: toLocalDateInputValue(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
      to: toLocalDateInputValue(new Date(d.getFullYear(), d.getMonth(), 0))
    })
  }

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

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 bg-white/80 backdrop-blur-xl p-2 rounded-[1.25rem] border border-[#E5D5C5]/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <button
              type="button"
              onClick={setThisMonth}
              className="px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase transition-all duration-300 text-[#8E8680] hover:text-[#84643B] hover:bg-[#84643B]/5"
            >
              Este mes
            </button>
            <button
              type="button"
              onClick={setLastMonth}
              className="px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase transition-all duration-300 text-[#8E8680] hover:text-[#84643B] hover:bg-[#84643B]/5"
            >
              Mes pasado
            </button>
          </div>

          <div className="flex items-center gap-2 bg-white/80 backdrop-blur-xl p-2 rounded-[1.25rem] border border-[#E5D5C5]/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
              className="bg-transparent border-none text-[10px] font-bold uppercase tracking-wider focus:ring-0 cursor-pointer outline-none"
            />
            <span className="text-[#B08B5A]/40 text-xs">→</span>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
              className="bg-transparent border-none text-[10px] font-bold uppercase tracking-wider focus:ring-0 cursor-pointer outline-none"
            />
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
          <div className="rounded-2xl bg-white/70 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#8E8680] border border-[#E5D5C5]/40">
            Filtro global: {days > 0 ? `${formatDateLabel(dateRange.from)} al ${formatDateLabel(dateRange.to)}` : 'rango no válido'}
          </div>
        </div>
      </div>
    </div>
  )
}
