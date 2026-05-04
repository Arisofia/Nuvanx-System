import { useState, useMemo } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { ExportButton } from '../reports/ExportButton'

export interface ColDef {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  /** Return null/undefined to render "—" */
  format?: (value: any, row: Record<string, any>) => string | number | null | undefined
  /** Set false to disable sorting on this column (default: sortable) */
  sortable?: boolean
}

interface Props {
  columns: ColDef[]
  rows: Record<string, any>[]
  pageSize?: number
  exportFilename?: string
  loading?: boolean
  emptyMessage?: string
  className?: string
  /** Optional totals footer row — same length as columns */
  footerRow?: (string | number | null | undefined)[]
}

type SortDir = 'asc' | 'desc' | null

function SortIcon({ col, sortKey, dir }: { col: string; sortKey: string | null; dir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="w-3 h-3 opacity-30 ml-1 inline" />
  if (dir === 'asc') return <ArrowUp className="w-3 h-3 ml-1 inline text-sky-400" />
  return <ArrowDown className="w-3 h-3 ml-1 inline text-sky-400" />
}

const alignClass = (align?: string) =>
  align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

export function SortableTable({
  columns,
  rows,
  pageSize = 50,
  exportFilename,
  loading,
  emptyMessage = 'No data available.',
  className = '',
  footerRow,
}: Props) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const n =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av ?? '').localeCompare(String(bv ?? ''))
      return sortDir === 'asc' ? n : -n
    })
  }, [rows, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paginated = sorted.slice(page * pageSize, (page + 1) * pageSize)

  const exportRows = useMemo(
    () =>
      sorted.map((row) => {
        const out: Record<string, any> = {}
        for (const col of columns) {
          const raw = row[col.key]
          out[col.label] = col.format ? (col.format(raw, row) ?? '') : (raw ?? '')
        }
        return out
      }),
    [sorted, columns],
  )

  const handleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDir === 'asc') {
        setSortDir('desc')
      } else {
        setSortKey(null)
        setSortDir(null)
      }
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(0)
  }

  if (loading) {
    return <p className="text-slate-500 text-sm py-8 text-center">Loading…</p>
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Controls row */}
      <div className="flex items-center justify-between gap-2 print:hidden">
        <p className="text-xs text-slate-500">
          {sorted.length.toLocaleString()} rows
          {totalPages > 1 ? ` · page ${page + 1} / ${totalPages}` : ''}
        </p>
        {exportFilename && (
          <ExportButton data={exportRows} filename={exportFilename} disabled={rows.length === 0} />
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm print:text-xs">
          <thead>
            <tr className="border-b border-slate-700 print:border-gray-400">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                  className={`px-3 py-2 text-xs font-semibold text-slate-400 whitespace-nowrap uppercase tracking-wide print:text-gray-600 ${alignClass(col.align)} ${col.sortable !== false ? 'cursor-pointer hover:text-white select-none' : ''}`}
                >
                  {col.label}
                  {col.sortable !== false && (
                    <SortIcon col={col.key} sortKey={sortKey} dir={sortDir} />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-10 text-center text-slate-500 text-sm"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginated.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors print:border-gray-200"
                >
                  {columns.map((col) => {
                    const raw = row[col.key]
                    const display = col.format ? col.format(raw, row) : raw
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2 text-slate-300 whitespace-nowrap print:text-gray-900 ${alignClass(col.align)}`}
                      >
                        {display == null ? '—' : String(display)}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
          {footerRow && (
            <tfoot>
              <tr className="border-t-2 border-slate-600 bg-slate-900 font-semibold text-xs text-slate-300 print:border-gray-400 print:bg-gray-100 print:text-gray-900">
                {footerRow.map((cell, i) => (
                  <td
                    key={i}
                    className={`px-3 py-2 whitespace-nowrap print:text-gray-900 ${alignClass(columns[i]?.align)}`}
                  >
                    {cell == null ? '' : String(cell)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1 print:hidden">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-400">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
