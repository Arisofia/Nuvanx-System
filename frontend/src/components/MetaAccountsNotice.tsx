import { useEffect, useState } from 'react'
import { getConfiguredMetaEntityIds, resolveMetaAccountIds, type MetaEntityId } from '../config/metaAccounts'
import { invokeApi } from '../lib/invokeApi'

type IntegrationRow = {
  service?: string
  status?: string
  metadata?: Record<string, unknown> | null
}

function normalizeAccountIds(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [value]
  return Array.from(new Set(
    source
      .flatMap((item) => String(item ?? '').split(/[\s,;]+/))
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const raw = item.toLowerCase().startsWith('act_') ? item.slice(4) : item
        const digits = raw.replaceAll(/\D/g, '')
        return digits ? `act_${digits}` : ''
      })
      .filter(Boolean),
  ))
}

function metadataValue(metadata: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' || typeof value === 'number') {
      const normalized = String(value).trim()
      if (normalized) return normalized
    }
  }
  return ''
}

function resolveRuntimeMetaEntities(metadata: Record<string, unknown> | null | undefined): MetaEntityId[] {
  const fallback = getConfiguredMetaEntityIds()
  if (!metadata || typeof metadata !== 'object') return fallback

  const accountIds = normalizeAccountIds(
    metadata.adAccountIds
    ?? metadata.ad_account_ids
    ?? metadata.adAccountId
    ?? metadata.ad_account_id,
  )
  const overrides: Record<string, string> = {
    'Pixel / Dataset': metadataValue(metadata, 'pixelId', 'pixel_id'),
    'Ad Accounts': accountIds.join(', '),
    'Facebook Page': metadataValue(metadata, 'pageId', 'page_id'),
    'Instagram Chamberí': metadataValue(metadata, 'igBusinessAccountId', 'ig_business_account_id'),
    'Portfolio NUVANX': metadataValue(metadata, 'businessPortfolioId', 'business_portfolio_id'),
  }

  const merged = fallback
    .map((entity) => ({ ...entity, value: overrides[entity.label] || entity.value }))
    .filter((entity) => entity.value)

  if (overrides['Ad Accounts'] && !merged.some((entity) => entity.label === 'Ad Accounts')) {
    merged.push({ label: 'Ad Accounts', value: overrides['Ad Accounts'] })
  }
  return merged
}

function useMetaEntities() {
  const [entities, setEntities] = useState<MetaEntityId[]>(() => getConfiguredMetaEntityIds())

  useEffect(() => {
    let active = true
    void invokeApi('/api/integrations')
      .then((response: { integrations?: IntegrationRow[] } | null | undefined) => {
        if (!active) return
        const meta = (response?.integrations ?? []).find((integration) => (
          integration?.service === 'meta' && integration?.status === 'connected'
        ))
        if (meta?.metadata) setEntities(resolveRuntimeMetaEntities(meta.metadata))
      })
      .catch(() => {
        // The public Vercel configuration is intentionally retained as a safe display fallback.
      })
    return () => { active = false }
  }, [])

  return entities
}

function MetaEntityList({ entities, compact = false }: Readonly<{ entities: MetaEntityId[]; compact?: boolean }>) {
  if (!entities.length) {
    return <p className="mt-1 text-xs font-semibold tracking-wide text-[#8E8680]">Sin entidades Meta configuradas.</p>
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
  const entities = useMetaEntities()
  const configuredRuntimeAccounts = entities.find((entity) => entity.label === 'Ad Accounts')?.value ?? ''
  const scopedAccounts = Array.from(new Set([
    ...resolveMetaAccountIds(accountIds),
    ...normalizeAccountIds(configuredRuntimeAccounts),
  ]))

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
      <MetaEntityList entities={entities} />
      {context && <p className="mt-2 text-[10px] font-medium text-[#8E8680]">{context}</p>}
    </div>
  )
}

export default function MetaAccountsNotice() {
  const entities = useMetaEntities()
  return (
    <aside
      aria-label="Entidades Meta configuradas"
      className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)] rounded-2xl border border-primary/15 bg-white/95 px-4 py-3 text-[#2C2825] shadow-[0_16px_40px_rgba(44,40,37,0.12)] backdrop-blur supports-[backdrop-filter]:bg-white/80"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary">Entidades Meta</p>
      <MetaEntityList entities={entities} compact />
    </aside>
  )
}
