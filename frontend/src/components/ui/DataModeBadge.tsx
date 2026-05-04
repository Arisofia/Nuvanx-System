import type { FC } from 'react';

type OverallMode = 'full_real' | 'partial_demo' | 'full_demo' | undefined;

interface DataModeBadgeProps {
  overallMode: OverallMode;
}

const config: Record<NonNullable<OverallMode>, { label: string; classes: string }> = {
  full_real:    { label: 'Datos reales',    classes: 'bg-green-500/15 text-green-400 border-green-500/30' },
  partial_demo: { label: 'Datos parciales', classes: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  full_demo:    { label: 'Modo demo',       classes: 'bg-red-500/15   text-red-400   border-red-500/30' },
};

const DataModeBadge: FC<DataModeBadgeProps> = ({ overallMode }) => {
  if (!overallMode || overallMode === 'full_real') return null;

  const { label, classes } = config[overallMode];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
};

export default DataModeBadge;
