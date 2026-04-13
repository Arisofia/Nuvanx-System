export default function FunnelChart({ stages }) {
  const maxValue = Math.max(...stages.map(s => s.value), 1);

  const colors = [
    { bg: 'bg-brand-500', text: 'text-brand-400', border: 'border-brand-500/30' },
    { bg: 'bg-violet-500', text: 'text-violet-400', border: 'border-violet-500/30' },
    { bg: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500/30' },
    { bg: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    { bg: 'bg-pink-500', text: 'text-pink-400', border: 'border-pink-500/30' },
  ];

  return (
    <div className="space-y-3">
      {stages.map((stage, index) => {
        const width = Math.max((stage.value / maxValue) * 100, 8);
        const color = colors[index % colors.length];
        const conversionRate = index > 0 && stages[index - 1].value > 0
          ? ((stage.value / stages[index - 1].value) * 100).toFixed(1)
          : null;

        return (
          <div key={stage.label} className="relative">
            <div className="flex items-center gap-3 mb-1.5">
              <span className="text-xs text-gray-500 w-5 text-right">{index + 1}</span>
              <span className="text-sm font-medium text-gray-300">{stage.label}</span>
              {conversionRate && (
                <span className={`ml-auto text-xs font-medium ${color.text}`}>
                  ↓ {conversionRate}% conversion
                </span>
              )}
              <span className="text-sm font-bold text-white min-w-[3rem] text-right">
                {stage.value.toLocaleString()}
              </span>
            </div>
            <div className="h-8 bg-dark-800 rounded-lg overflow-hidden border border-dark-600">
              <div
                className={`h-full ${color.bg} rounded-lg transition-all duration-700 ease-out flex items-center justify-end pr-3`}
                style={{ width: `${width}%` }}
              >
                {width > 20 && (
                  <span className="text-xs font-medium text-white/80">
                    {((stage.value / maxValue) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
