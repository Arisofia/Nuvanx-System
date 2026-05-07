import { TrendingDown, TrendingUp } from 'lucide-react'

interface MetricDeltaProps {
  readonly value: number
  readonly inverse?: boolean
}

export function MetricDelta({ value, inverse = false }: MetricDeltaProps) {
  if (value === 0) return null

  const isPositive = value > 0
  const isGood = inverse ? !isPositive : isPositive

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
      isGood 
        ? 'bg-green-500/10 text-green-600 border border-green-500/20' 
        : 'bg-red-500/10 text-red-600 border border-red-500/20'
    }`}>
      {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isPositive ? '+' : ''}{value}%
    </span>
  )
}
