import {
  googleAdsAccountIds,
  metaAccountIds,
  metaAppId,
  metaBusinessPortfolioNuvanxId,
  metaBusinessPortfolioYolandaId,
  metaInstagramChamberiId,
  metaInstagramGoyaId,
  metaPageId,
  metaPixelId,
} from '../lib/env'

function splitIds(value: string) {
  return value
    ? value.split(',').map(id => id.trim()).filter(Boolean)
    : []
}

export const META_APP_ID = metaAppId
export const META_ACCOUNT_IDS = splitIds(metaAccountIds) as readonly string[]
export const META_PIXEL_IDS = splitIds(metaPixelId) as readonly string[]
export const META_PAGE_ID = metaPageId
export const META_INSTAGRAM_CHAMBERI_ID = metaInstagramChamberiId
export const META_INSTAGRAM_GOYA_ID = metaInstagramGoyaId
export const META_BUSINESS_PORTFOLIO_NUVANX_ID = metaBusinessPortfolioNuvanxId
export const META_BUSINESS_PORTFOLIO_YOLANDA_ID = metaBusinessPortfolioYolandaId
export const GOOGLE_ADS_ACCOUNT_IDS = splitIds(googleAdsAccountIds) as readonly string[]

export interface MetaEntityId {
  label: string
  value: string
}

export function getConfiguredMetaEntityIds(): MetaEntityId[] {
  return [
    { label: 'Meta App', value: META_APP_ID },
    { label: 'Pixel / Dataset', value: META_PIXEL_IDS.join(', ') },
    { label: 'Ad Accounts', value: META_ACCOUNT_IDS.join(', ') },
    { label: 'Facebook Page', value: META_PAGE_ID },
    { label: 'Instagram Chamberí', value: META_INSTAGRAM_CHAMBERI_ID },
    { label: 'Instagram Goya', value: META_INSTAGRAM_GOYA_ID },
    { label: 'Portfolio NUVANX', value: META_BUSINESS_PORTFOLIO_NUVANX_ID },
    { label: 'Portfolio Yolanda', value: META_BUSINESS_PORTFOLIO_YOLANDA_ID },
  ].filter((item) => item.value)
}

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
