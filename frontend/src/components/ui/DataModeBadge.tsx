import type { FC } from 'react';

type OverallMode = 'LIVE' | 'PARTIAL_LIVE' | 'STALE' | 'full_real' | 'partial_demo' | 'full_demo' | 'unknown' | undefined;

interface DataModeBadgeProps {
  overallMode: OverallMode;
}

const config: Record<Exclude<NonNullable<OverallMode>, 'full_real' | 'LIVE'>, { label: string; classes: string }> = {
  PARTIAL_LIVE: { label: 'Datos parcialmente actualizados', classes: 'mode-partial_demo' },
  STALE: { label: 'Datos desactualizados', classes: 'mode-unknown' },
  partial_demo: { label: 'Datos parciales', classes: 'mode-partial_demo' },
  full_demo: { label: 'Modo demo', classes: 'mode-full_demo' },
  unknown: { label: 'Calidad desconocida', classes: 'mode-unknown' },
};

const DataModeBadge: FC<DataModeBadgeProps> = ({ overallMode }) => {
  if (!overallMode || overallMode === 'full_real' || overallMode === 'LIVE') return null;

  const modeConfig = config[overallMode as keyof typeof config] || config.unknown;
  const { label, classes } = modeConfig;

  return (
    <span className={`mode-badge ${classes}`}>
      <span className="mode-badge-dot" />
      {label}
    </span>
  );
};

export default DataModeBadge;
