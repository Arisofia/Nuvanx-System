import { META_ACCOUNT_IDS, resolveMetaAccountIds } from '../config/metaAccounts'

export function MetaAccountsInline({
  accountIds,
  context = 'Campañas, anuncios y leads Meta auditados contra estas cuentas.',
  className = '',
}: Readonly<{ accountIds?: readonly unknown[]; context?: string; className?: string }>) {
  return (
    <div className={`rounded-2xl border border-primary/15 bg-white/70 px-4 py-3 shadow-sm ${className}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary">Cuentas Meta</p>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold tracking-wide text-[#2C2825]">
        {resolveMetaAccountIds(accountIds).map((accountId) => (
          <span key={accountId}>{accountId}</span>
        ))}
      </p>
      {context && <p className="mt-1 text-[10px] font-medium text-[#8E8680]">{context}</p>}
    </div>
  )
}

export default function MetaAccountsNotice() {
  return (
    <aside
      aria-label="Cuentas Meta configuradas"
      className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)] rounded-2xl border border-primary/15 bg-white/95 px-4 py-3 text-[#2C2825] shadow-[0_16px_40px_rgba(44,40,37,0.12)] backdrop-blur supports-[backdrop-filter]:bg-white/80"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary">Cuentas Meta</p>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold tracking-wide">
        {META_ACCOUNT_IDS.map((accountId) => (
          <span key={accountId}>{accountId}</span>
        ))}
      </p>
    </aside>
  )
}
