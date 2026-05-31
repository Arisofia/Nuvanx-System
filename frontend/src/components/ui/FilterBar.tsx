import { useState } from 'react'
import { Calendar } from 'lucide-react'

export interface FilterBarProps {
  /** Called whenever the date range changes. Empty strings mean "no filter / all time". */
  readonly onDateChange: (from: string, to: string) => void
  /** Optional campaign dropdown */
  readonly campaigns?: { id: string; name: string }[]
  readonly onCampaignChange?: (id: string) => void
  readonly campaignValue?: string
  /** Optional source dropdown */
  readonly sources?: string[]
  readonly onSourceChange?: (src: string) => void
  readonly sourceValue?: string
}

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: 'All', days: 0 },
] as const

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function FilterBar({
  onDateChange,
  campaigns,
  onCampaignChange,
  campaignValue = 'ALL',
  sources,
  onSourceChange,
  sourceValue = 'ALL',
}: FilterBarProps) {
  const [activeDays, setActiveDays] = useState<number>(30)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [customMode, setCustomMode] = useState(false)

  const since2025 = '2025-01-01'

  const setPreset = (days: number) => {
    setActiveDays(days)
    setCustomMode(false)
    setFrom('')
    setTo('')
    if (days > 0) {
      onDateChange(daysAgo(days), todayISO())
    } else {
      onDateChange('', '')
    }
  }

  const setFrom2025 = () => {
    const t = todayISO()
    setActiveDays(-1)
    setCustomMode(true)
    setFrom(since2025)
    setTo(t)
    onDateChange(since2025, t)
  }

  const handleFromChange = (v: string) => {
    setFrom(v)
    setActiveDays(-1)
    setCustomMode(true)
    onDateChange(v, to || todayISO())
  }

  const handleToChange = (v: string) => {
    setTo(v)
    setActiveDays(-1)
    setCustomMode(true)
    onDateChange(from || daysAgo(30), v)
  }

  const is2025 = customMode && from === since2025

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {/* Preset buttons */}
      <div className="flex items-center gap-1 bg-card rounded-lg p-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => setPreset(p.days)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              !customMode && activeDays === p.days
                ? 'bg-primary/15 text-foreground'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={setFrom2025}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            is2025 ? 'bg-primary text-white' : 'text-muted hover:text-foreground'
          }`}
        >
          2025+
        </button>
      </div>

      {/* Custom date inputs */}
      <div className="flex items-center gap-1">
        <Calendar className="w-3.5 h-3.5 text-muted" />
        <input
          type="date"
          value={from}
          onChange={(e) => handleFromChange(e.target.value)}
          className="bg-card border border-border rounded px-2 py-1 text-foreground text-xs focus:outline-none focus:border-muted w-32"
        />
        <span className="text-muted text-xs">→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => handleToChange(e.target.value)}
          className="bg-card border border-border rounded px-2 py-1 text-foreground text-xs focus:outline-none focus:border-muted w-32"
        />
      </div>

      {/* Campaign select */}
      {campaigns && campaigns.length > 0 && onCampaignChange && (
        <select
          value={campaignValue}
          onChange={(e) => onCampaignChange(e.target.value)}
          className="bg-card text-foreground text-xs font-medium px-3 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary max-w-[200px]"
        >
          <option value="ALL">All Campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      {/* Source select */}
      {sources && sources.length > 0 && onSourceChange && (
        <select
          value={sourceValue}
          onChange={(e) => onSourceChange(e.target.value)}
          className="bg-card text-foreground text-xs font-medium px-3 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="ALL">All Sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      )}
    </div>
  )
}
