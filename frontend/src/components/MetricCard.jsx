import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function MetricCard({ title, value, change, changeLabel, icon: Icon, color = 'brand', prefix = '', suffix = '' }) {
  const isPositive = change > 0;
  const isNeutral = change === 0;

  const colorMap = {
    brand: 'from-brand-500/10 to-brand-600/5 border-brand-500/20',
    emerald: 'from-emerald-500/10 to-emerald-600/5 border-emerald-500/20',
    violet: 'from-violet-500/10 to-violet-600/5 border-violet-500/20',
    amber: 'from-amber-500/10 to-amber-600/5 border-amber-500/20',
  };

  const iconColorMap = {
    brand: 'bg-brand-500/20 text-brand-400',
    emerald: 'bg-emerald-500/20 text-emerald-400',
    violet: 'bg-violet-500/20 text-violet-400',
    amber: 'bg-amber-500/20 text-amber-400',
  };

  return (
    <div className={`relative overflow-hidden rounded-xl border bg-gradient-to-br p-6 ${colorMap[color]}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-400 mb-1">{title}</p>
          <p className="text-3xl font-bold text-white tracking-tight">
            {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
          </p>
        </div>
        {Icon && (
          <div className={`p-3 rounded-xl ${iconColorMap[color]}`}>
            <Icon size={22} />
          </div>
        )}
      </div>
      {change !== undefined && (
        <div className="mt-4 flex items-center gap-2">
          <span className={`flex items-center gap-1 text-sm font-medium ${isNeutral ? 'text-gray-400' : isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {isNeutral ? <Minus size={14} /> : isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {isPositive ? '+' : ''}{change}%
          </span>
          <span className="text-xs text-gray-500">{changeLabel || 'vs last month'}</span>
        </div>
      )}
    </div>
  );
}
