// Security regression contract for clinic-scoped Meta ownership and strict trusted E2E.
// NUVANX Meta resolution is clinic-required; clinic-less user/credential fallback is forbidden.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const api = fs.readFileSync('supabase/functions/api/index.ts', 'utf8');
const smoke = fs.readFileSync('frontend/tests/smoke.playwright.ts', 'utf8');

const integrationStart = api.indexOf('async function resolveMetaIntegration');
const resolverStart = api.indexOf('async function resolveMetaCreds');
const resolverEnd = api.indexOf('function selectCanonicalMetaIntegration', resolverStart);
const integrationSection = api.slice(integrationStart, resolverStart);
const resolver = api.slice(resolverStart, resolverEnd);

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Meta tenant-safe resolution contract', () => {
  it('propagates clinic lookup errors instead of silently falling back to legacy user scope', () => {
    const start = api.indexOf('async function resolveClinicId');
    const end = api.indexOf('async function persistAgentOutput', start);
    const source = api.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(source).toContain(".select('clinic_id').eq('id', userId).maybeSingle()");
    expect(source).toContain('if (error) throw error;');
  });

  it('resolves the connected integration from the requester clinic', () => {
    expect(integrationStart).toBeGreaterThan(-1);
    expect(integrationSection).toContain('const requesterClinicId = await resolveClinicId(adminClient, userId);');
    expect(integrationSection).toContain(".select('user_id, clinic_id, service, metadata, status, updated_at')");
    expect(integrationSection).toContain('if (!requesterClinicId) {');
    expect(integrationSection).toContain('integration: null');
    expect(integrationSection).toContain(".eq('clinic_id', requesterClinicId)");
    expect(integrationSection).not.toContain(".is('clinic_id', null)");
    expect(integrationSection).not.toContain(".eq('clinic_id', requesterClinicId).or(");
  });

  it('uses the selected integration owner for the credential while preserving clinic isolation', () => {
    expect(resolverStart).toBeGreaterThan(-1);
    expect(resolverEnd).toBeGreaterThan(resolverStart);
    expect(resolver).toContain("const integrationService = intg.service === 'meta_ads' ? 'meta_ads' : 'meta';");
    expect(resolver).toContain("const integrationOwnerId = String(intg.user_id ?? '').trim();");
    expect(resolver).toContain(".eq('user_id', integrationOwnerId)");
    expect(resolver).toContain("credentialQuery.eq('clinic_id', requesterClinicId)");
    expect(resolver).toContain("credentialQuery = credentialQuery.eq('clinic_id', requesterClinicId);");
    expect(resolver).not.toContain("credentialQuery.is('clinic_id', null)");
    expect(resolver).not.toContain(".eq('user_id', userId)\n    .eq('service', credentialService)");
  });

  it('fails closed in every resolveMetaCreds missing-context branch', () => {
    const missingIntegration = sliceBetween(resolver, 'if (!intg) {', 'const integrationService');
    expect(missingIntegration).toContain('notConnected: true');
    expect(missingIntegration).toContain("integrationOwnerId: ''");
    expect(missingIntegration).toContain("integrationService: ''");
    expect(missingIntegration).toContain('requesterClinicId,');

    const missingOwner = sliceBetween(resolver, 'if (!integrationOwnerId) {', 'if (!requesterClinicId) {');
    expect(missingOwner).toContain('notConnected: true');
    expect(missingOwner).toContain("integrationOwnerId: ''");
    expect(missingOwner).toContain('integrationService,');
    expect(missingOwner).toContain('requesterClinicId,');

    const missingClinic = sliceBetween(resolver, 'if (!requesterClinicId) {', 'const credentialService');
    expect(missingClinic).toContain('notConnected: true');
    expect(missingClinic).toContain('integrationOwnerId,');
    expect(missingClinic).toContain('integrationService,');
    expect(missingClinic).toContain('requesterClinicId,');

    const missingCredential = sliceBetween(resolver, 'if (!credRow?.encrypted_key) {', "let accessToken = '';");
    expect(missingCredential).toContain('notConnected: true');
    expect(missingCredential).toContain('integrationOwnerId,');
    expect(missingCredential).toContain('integrationService,');
    expect(missingCredential).toContain('requesterClinicId,');
  });

  it('updates every Meta integration-test status write through canonical owner and service', () => {
    const start = api.indexOf('async function handleIntegrationsTestPost');
    const end = api.indexOf('async function handlePlaybooksGet', start);
    const source = api.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source).toContain("if (service === 'meta' || service === 'meta_ads') {");
    expect(source).toContain("const integrationOwnerId = creds.integrationOwnerId ?? '';");
    expect(source).toContain("const integrationService = creds.integrationService ?? '';");

    const calls = [...source.matchAll(/updateIntegrationStatus\(adminClient,\s*([^,]+),\s*([^,]+),/g)];
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call[1].trim()).toBe('integrationOwnerId');
      expect(call[2].trim()).toBe('integrationService');
    }
    expect(source).not.toContain("updateIntegrationStatus(adminClient, userId, 'meta'");
    expect(source).not.toContain("updateIntegrationStatus(adminClient, userId, 'meta_ads'");
  });

  it('scopes historical CRM campaign snapshots for AI through clinic member user IDs', () => {
    const start = api.indexOf('async function fetchDbCampaigns');
    const end = api.indexOf('async function fetchMetaCampaignsFallback', start);
    const source = api.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(source).toContain(".from('users')");
    expect(source).toContain(".eq('clinic_id', requesterClinicId)");
    expect(source).toContain("query = query.in('user_id', clinicUserIds)");
    expect(source).not.toContain('applyClinicOrUserScope(query, requesterClinicId, userId)');
  });

  it('keeps persisted Organic and Instagram reads clinic-required', () => {
    const organic = api.slice(api.indexOf('async function handleMetaOrganicGet'), api.indexOf('async function handleMetaIgGet'));
    const ig = api.slice(api.indexOf('async function handleMetaIgGet'), api.indexOf('function parseMetaBackfillDates'));
    expect(organic).toContain('resolveMetaIntegration(adminClient, userId');
    expect(organic).toContain('if (!integ || !requesterClinicId)');
    expect(organic).toContain("query = query.eq('clinic_id', requesterClinicId)");
    expect(organic).not.toContain('applyClinicOrUserScope(query, requesterClinicId, userId)');

    expect(ig).toContain('resolveMetaIntegration(adminClient, userId');
    expect(ig).toContain('if (!integ || !requesterClinicId)');
    expect(ig).toContain('const igId: string | null = meta.igBusinessAccountId ?? meta.ig_business_account_id ?? null;');
    expect(ig).toContain('Instagram Business Account ID not configured in integration metadata');
    expect(ig).not.toContain('igDiscoverQuery');
    expect(ig).not.toMatch(/\.from\('meta_ig_account_daily'\)[\s\S]{0,180}\.limit\(1\)/);
    expect(ig).toContain("query = query.eq('clinic_id', requesterClinicId)");
    expect(ig).not.toContain('applyClinicOrUserScope(query, requesterClinicId, userId)');
  });

  it('paginates persisted post/media reads until enough unique IDs are collected or the relation is exhausted', () => {
    const organic = api.slice(api.indexOf('async function handleMetaOrganicGet'), api.indexOf('async function handleMetaIgGet'));
    const ig = api.slice(api.indexOf('async function handleMetaIgGet'), api.indexOf('function parseMetaBackfillDates'));

    expect(organic).toContain(".order('updated_at', { ascending: false })");
    expect(organic).toContain(".order('created_time', { ascending: false })");
    expect(organic).toContain('.range(offset, offset + pageSize - 1)');
    expect(organic).toContain('uniquePostsMap.size < limit');
    expect(organic).toContain('page.length < pageSize');
    expect(organic).not.toContain('.limit(Math.min(limit * 5, 1000))');
    expect(organic).toContain(".order('date', { ascending: true })");

    expect(ig).toContain(".order('updated_at', { ascending: false })");
    expect(ig).toContain(".order('timestamp', { ascending: false })");
    expect(ig).toContain('.range(offset, offset + pageSize - 1)');
    expect(ig).toContain('uniquePostsMap.size < limit');
    expect(ig).toContain('page.length < pageSize');
    expect(ig).not.toContain('.limit(Math.min(limit * 5, 1000))');
    expect(ig).toContain(".order('date', { ascending: true })");
  });

  it('keeps trusted Playwright strict: no disposable-provider 400 allowlist', () => {
    expect(smoke).toContain('httpErrors.push(`${response.status()} ${response.url()}`);');
    expect(smoke).toContain('received Supabase HTTP 4xx/5xx responses');
    expect(smoke).not.toContain('DISPOSABLE_META_PROVIDER_PATHS');
    expect(smoke).not.toContain('isExpectedDisposableProviderState');
    expect(smoke).not.toContain('[EXPECTED PROVIDER STATE]');
  });

  it('keeps same-day from/to ranges valid and reports one day', () => {
    const start = api.indexOf('function getKpiDateRange(url: URL)');
    const end = api.indexOf('function processLeadsByStage', start);
    const rangeSource = api.slice(start, end).replace('function getKpiDateRange(url: URL)', 'function getKpiDateRange(url)');
    const getKpiDateRange = new Function(`${rangeSource}; return getKpiDateRange;`)();
    const result = getKpiDateRange(new URL('https://example.test/?from=2026-09-01&to=2026-09-01'));
    expect(result.since).toBe('2026-09-01');
    expect(result.until).toBe('2026-09-01');
    expect(result.days).toBe(1);
    expect(result.period.range).toBe('1d');
  });
});