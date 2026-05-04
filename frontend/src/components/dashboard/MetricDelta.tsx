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
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${isGood ? 'delta-positive' : 'delta-negative'}`}>
      {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isPositive ? '+' : ''}{value}%
    </span>
  )
}
