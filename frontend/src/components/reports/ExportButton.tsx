import { Download } from 'lucide-react'
import { Button } from '../ui/button'

interface Props {
  data: Record<string, any>[]
  filename: string
  disabled?: boolean
}

function toCSV(rows: Record<string, any>[]): string {
  if (rows.length === 0) return ''
  const keys = Object.keys(rows[0])
  const escape = (v: any) => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [keys.join(','), ...rows.map((r) => keys.map((k) => escape(r[k])).join(','))].join('\n')
}

export function ExportButton({ data, filename, disabled }: Props) {
  const handleExport = () => {
    if (data.length === 0) return
    const blob = new Blob([toCSV(data)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2"
      onClick={handleExport}
      disabled={disabled || data.length === 0}
    >
      <Download className="w-4 h-4" />
      Export CSV
    </Button>
  )
}
