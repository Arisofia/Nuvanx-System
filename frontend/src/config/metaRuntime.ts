import { getConfiguredMetaEntityIds, type MetaEntityId } from './metaAccounts'

export type IntegrationRow = {
  service?: string
  status?: string
  metadata?: Record<string, unknown> | null
}

export function normalizeAccountIds(value: unknown): string[] {
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

export function selectCanonicalMetaIntegration(integrations: readonly IntegrationRow[]): IntegrationRow | null {
  return integrations.find((integration) => (
    integration?.service === 'meta_ads'
    && integration?.status === 'connected'
    && integration?.metadata?.canonical === true
  )) ?? null
}

export function resolveRuntimeMetaEntities(
  metadata: Record<string, unknown> | null | undefined,
  fallback: MetaEntityId[] = getConfiguredMetaEntityIds(),
): MetaEntityId[] {
  if (!metadata || typeof metadata !== 'object') return fallback

  const accountIds = normalizeAccountIds(
    metadata.adAccountIds
    ?? metadata.ad_account_ids
    ?? metadata.adAccountId
    ?? metadata.ad_account_id,
  )

  const runtimeEntities: MetaEntityId[] = [
    { label: 'Meta App', value: metadataValue(metadata, 'appId', 'app_id') },
    { label: 'Pixel / Dataset', value: metadataValue(metadata, 'pixelId', 'pixel_id') },
    { label: 'Ad Accounts', value: accountIds.join(', ') },
    { label: 'Facebook Page', value: metadataValue(metadata, 'pageId', 'page_id') },
    { label: 'Instagram Chamberí', value: metadataValue(metadata, 'igBusinessAccountId', 'ig_business_account_id') },
    { label: 'Portfolio NUVANX', value: metadataValue(metadata, 'businessPortfolioId', 'business_portfolio_id') },
  ].filter((entity) => entity.value)

  const runtimeLabels = new Set(runtimeEntities.map((entity) => entity.label))
  return [
    ...fallback.filter((entity) => !runtimeLabels.has(entity.label)),
    ...runtimeEntities,
  ]
}
