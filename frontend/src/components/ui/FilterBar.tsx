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
  { label: 'Todo', days: 0 },
] as const

function toLocalDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function daysAgo(n: number): string {
  const date = new Date()
  date.setDate(date.getDate() - n)
  return toLocalDateInputValue(date)
}

function todayLocal(): string {
  return toLocalDateInputValue(new Date())
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

  const setPreset = (days: number) => {
    setActiveDays(days)
    setCustomMode(false)
    setFrom('')
    setTo('')
    if (days > 0) {
      onDateChange(daysAgo(days), todayLocal())
    } else {
      onDateChange('', '')
    }
  }

  const handleFromChange = (v: string) => {
    setFrom(v)
    setActiveDays(-1)
    setCustomMode(true)
    onDateChange(v, to || todayLocal())
  }

  const handleToChange = (v: string) => {
    setTo(v)
    setActiveDays(-1)
    setCustomMode(true)
    onDateChange(from || daysAgo(30), v)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <div className="flex items-center gap-1 bg-card rounded-lg p-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
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
      </div>

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

      {campaigns && campaigns.length > 0 && onCampaignChange && (
        <select
          value={campaignValue}
          onChange={(e) => onCampaignChange(e.target.value)}
          className="bg-card text-foreground text-xs font-medium px-3 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary max-w-[200px]"
        >
          <option value="ALL">Todas las campañas</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      {sources && sources.length > 0 && onSourceChange && (
        <select
          value={sourceValue}
          onChange={(e) => onSourceChange(e.target.value)}
          className="bg-card text-foreground text-xs font-medium px-3 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="ALL">Todas las fuentes</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      )}
    </div>
  )
}
