import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveMetaAccountIds } from '../src/config/metaAccounts'
import {
  resolveRuntimeMetaEntities,
  selectCanonicalMetaIntegration,
  type IntegrationRow,
} from '../src/components/MetaAccountsNotice'

describe('canonical Meta account source', () => {
  it('resolves ad-account IDs only from runtime input', () => {
    expect(resolveMetaAccountIds([
      'act_718120894191565',
      'act_718120894191565',
    ])).toEqual(['act_718120894191565'])
  })

  it('selects connected canonical meta_ads and ignores legacy meta', () => {
    const legacy: IntegrationRow = {
      service: 'meta',
      status: 'connected',
      metadata: { adAccountIds: ['act_9523446201036125'] },
    }
    const canonical: IntegrationRow = {
      service: 'meta_ads',
      status: 'connected',
      metadata: {
        canonical: true,
        appId: '1836302544001572',
        adAccountIds: ['act_718120894191565'],
        pixelId: '1037346649192028',
        pageId: '1329458703573874',
        businessPortfolioId: '897835716596010',
      },
    }

    expect(selectCanonicalMetaIntegration([legacy, canonical])).toBe(canonical)
  })

  it('overrides stale fallback entities with canonical runtime metadata', () => {
    const entities = resolveRuntimeMetaEntities(
      {
        canonical: true,
        appId: '1836302544001572',
        adAccountIds: ['act_718120894191565'],
        pixelId: '1037346649192028',
        pageId: '1329458703573874',
        businessPortfolioId: '897835716596010',
      },
      [
        { label: 'Meta App', value: 'legacy-app' },
        { label: 'Ad Accounts', value: 'act_9523446201036125, act_4172099716404860' },
      ],
    )

    expect(entities).toContainEqual({ label: 'Meta App', value: '1836302544001572' })
    expect(entities).toContainEqual({ label: 'Ad Accounts', value: 'act_718120894191565' })
    expect(entities.some((entity) => entity.value.includes('9523446201036125'))).toBe(false)
    expect(entities.some((entity) => entity.value.includes('4172099716404860'))).toBe(false)
  })

  it('does not expose a Vite Meta ad-account variable in frontend runtime env', () => {
    const envSource = readFileSync(new URL('../src/lib/env.ts', import.meta.url), 'utf8')
    const exampleSource = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')

    expect(envSource).not.toContain('VITE_META_AD_ACCOUNT_IDS')
    expect(exampleSource).not.toContain('VITE_META_AD_ACCOUNT_IDS=')
  })
})
