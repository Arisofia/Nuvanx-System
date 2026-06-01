// This component is highly domain-specific (data quality mode for the dashboard).
// It makes more sense living inside the dashboard folder.

import type { FC } from 'react';

type OverallMode = 'full_real' | 'partial_demo' | 'full_demo' | 'unknown' | undefined;

interface DataModeBadgeProps {
  overallMode: OverallMode;
}

const config: Record<NonNullable<OverallMode>, { label: string; classes: string }> = {
  full_real:    { label: 'Datos reales',    classes: 'mode-full_real' },
  partial_demo: { label: 'Datos parciales', classes: 'mode-partial_demo' },
  full_demo:    { label: 'Modo demo',       classes: 'mode-full_demo' },
  unknown:      { label: 'Calidad desconocida', classes: 'mode-unknown' },
};

const DataModeBadge: FC<DataModeBadgeProps> = ({ overallMode }) => {
  if (!overallMode || overallMode === 'full_real') return null;

  const modeConfig = config[overallMode] || config.unknown;
  const { label, classes } = modeConfig;

  return (
    <span className={`mode-badge ${classes}`}>
      <span className="mode-badge-dot" />
      {label}
    </span>
  );
};

export default DataModeBadge;
