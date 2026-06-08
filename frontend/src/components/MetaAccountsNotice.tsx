import { getConfiguredMetaEntityIds, resolveMetaAccountIds } from '../config/metaAccounts'

function MetaEntityList({ compact = false }: Readonly<{ compact?: boolean }>) {
  const entities = getConfiguredMetaEntityIds()

  if (!entities.length) {
    return <p className="mt-1 text-xs font-semibold tracking-wide text-[#8E8680]">Sin IDs Meta públicos configurados en Vercel.</p>
  }

  return (
    <dl className={compact ? 'mt-2 grid grid-cols-1 gap-1 text-[10px]' : 'mt-2 grid grid-cols-1 gap-1.5 text-xs'}>
      {entities.map((entity) => (
        <div key={`${entity.label}:${entity.value}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <dt className="font-bold uppercase tracking-[0.16em] text-[#8E8680]">{entity.label}</dt>
          <dd className="font-semibold tracking-wide text-[#2C2825]">{entity.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function MetaAccountsInline({
  accountIds,
  context = 'Campañas, anuncios y leads Meta auditados contra estas entidades.',
  className = '',
}: Readonly<{ accountIds?: readonly unknown[]; context?: string; className?: string }>) {
  const scopedAccounts = resolveMetaAccountIds(accountIds)

  return (
    <div className={`rounded-2xl border border-primary/15 bg-white/70 px-4 py-3 shadow-sm ${className}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary">Entidades Meta</p>
      {scopedAccounts.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold tracking-wide text-[#2C2825]">
          {scopedAccounts.map((accountId) => (
            <span key={accountId}>{accountId}</span>
          ))}
        </p>
      )}
      <MetaEntityList />
      {context && <p className="mt-2 text-[10px] font-medium text-[#8E8680]">{context}</p>}
    </div>
  )
}

export default function MetaAccountsNotice() {
  return (
    <aside
      aria-label="Entidades Meta configuradas"
      className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)] rounded-2xl border border-primary/15 bg-white/95 px-4 py-3 text-[#2C2825] shadow-[0_16px_40px_rgba(44,40,37,0.12)] backdrop-blur supports-[backdrop-filter]:bg-white/80"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary">Entidades Meta</p>
      <MetaEntityList compact />
    </aside>
  )
}
