export const META_ACCOUNT_IDS = ['act_9523446201036125', 'act_4172099716404860'] as const
export const META_PIXEL_IDS = ['1405503384615251'] as const
export const GOOGLE_ADS_ACCOUNT_IDS = ['AW-18182220789'] as const

export function resolveMetaAccountIds(accountIds: readonly unknown[] = []) {
  const normalized = [...META_ACCOUNT_IDS, ...accountIds]
    .map((accountId) => String(accountId ?? '').trim())
    .filter(Boolean)

  return Array.from(new Set(normalized))
}

export function resolveMetaPixelIds(pixelIds: readonly unknown[] = []) {
  const normalized = [...META_PIXEL_IDS, ...pixelIds]
    .map((pixelId) => String(pixelId ?? '').trim())
    .filter(Boolean)

  return Array.from(new Set(normalized))
}

export function resolveGoogleAdsAccountIds(accountIds: readonly unknown[] = []) {
  const normalized = [...GOOGLE_ADS_ACCOUNT_IDS, ...accountIds]
    .map((accountId) => String(accountId ?? '').trim())
    .filter(Boolean)

  return Array.from(new Set(normalized))
}

export function formatMetaAccountIds(accountIds?: readonly unknown[]) {
  return resolveMetaAccountIds(accountIds).join(', ')
}

export function formatMetaPixelIds(pixelIds?: readonly unknown[]) {
  return resolveMetaPixelIds(pixelIds).join(', ')
}

export function formatGoogleAdsAccountIds(accountIds?: readonly unknown[]) {
  return resolveGoogleAdsAccountIds(accountIds).join(', ')
}
