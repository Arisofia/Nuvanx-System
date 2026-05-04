import { TrendingDown, TrendingUp } from 'lucide-react'

interface MetricDeltaProps {
  value: number
  inverse?: boolean
}

export function MetricDelta({ value, inverse = false }: MetricDeltaProps) {
  if (value === 0) return null

  const isPositive = value > 0
  const isGood = inverse ? !isPositive : isPositive

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${isGood ? 'text-[#8ee0b8]' : 'text-[#f16b62]'}`}>
      {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isPositive ? '+' : ''}{value}%
    </span>
  )
}
