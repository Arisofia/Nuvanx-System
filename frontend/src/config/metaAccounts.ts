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

const DEFAULT_META_APP_ID = '878822511043717'
const DEFAULT_META_ACCOUNT_IDS = '9523446201036125,120224800893290701,4172099716404860'
const DEFAULT_META_PIXEL_IDS = '1405503384615251'
const DEFAULT_META_PAGE_ID = '685010274687129'
const DEFAULT_META_INSTAGRAM_CHAMBERI_ID = '17841474094610850'
const DEFAULT_META_BUSINESS_PORTFOLIO_NUVANX_ID = '878822511043717'

function splitIds(value: string) {
  return value
    ? value.split(',').map(id => id.trim()).filter(Boolean)
    : []
}

function withFallback(value: string, fallback: string) {
  return value?.trim() || fallback
}

export const META_APP_ID = withFallback(metaAppId, DEFAULT_META_APP_ID)
export const META_ACCOUNT_IDS = splitIds(withFallback(metaAccountIds, DEFAULT_META_ACCOUNT_IDS)) as readonly string[]
export const META_PIXEL_IDS = splitIds(withFallback(metaPixelId, DEFAULT_META_PIXEL_IDS)) as readonly string[]
export const META_PAGE_ID = withFallback(metaPageId, DEFAULT_META_PAGE_ID)
export const META_INSTAGRAM_CHAMBERI_ID = withFallback(metaInstagramChamberiId, DEFAULT_META_INSTAGRAM_CHAMBERI_ID)
export const META_INSTAGRAM_GOYA_ID = metaInstagramGoyaId
export const META_BUSINESS_PORTFOLIO_NUVANX_ID = withFallback(metaBusinessPortfolioNuvanxId, DEFAULT_META_BUSINESS_PORTFOLIO_NUVANX_ID)
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
