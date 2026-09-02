// Security regression contract for clinic-scoped Meta ownership and strict trusted E2E.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const api = fs.readFileSync('supabase/functions/api/index.ts', 'utf8');
const smoke = fs.readFileSync('frontend/tests/smoke.playwright.ts', 'utf8');

const integrationStart = api.indexOf('async function resolveMetaIntegration');
const resolverStart = api.indexOf('async function resolveMetaCreds');
const resolverEnd = api.indexOf('function selectCanonicalMetaIntegration', resolverStart);
const integrationSection = api.slice(integrationStart, resolverStart);
const resolver = api.slice(resolverStart, resolverEnd);

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
    expect(integrationSection).toContain("integrationsQuery.eq('clinic_id', requesterClinicId)");
    expect(integrationSection).toContain("integrationsQuery.eq('user_id', userId).is('clinic_id', null)");
    expect(integrationSection).not.toContain(".eq('clinic_id', requesterClinicId).or(");
  });

  it('uses the selected integration owner for the credential while preserving clinic isolation', () => {
    expect(resolverStart).toBeGreaterThan(-1);
    expect(resolverEnd).toBeGreaterThan(resolverStart);
    expect(resolver).toContain("const integrationService = intg.service === 'meta_ads' ? 'meta_ads' : 'meta';");
    expect(resolver).toContain('const integrationOwnerId = String(intg.user_id ?? \'\').trim();');
    expect(resolver).toContain(".eq('user_id', integrationOwnerId)");
    expect(resolver).toContain("credentialQuery.eq('clinic_id', requesterClinicId)");
    expect(resolver).toContain("credentialQuery.is('clinic_id', null)");
    expect(resolver).toContain('integrationOwnerId,');
    expect(resolver).toContain('integrationService,');
    expect(resolver).not.toContain(".eq('user_id', userId)\n    .eq('service', credentialService)");
  });

  it('fails closed when integration or owner credential is missing', () => {
    expect((resolver.match(/notConnected: true/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(resolver).toContain("integrationOwnerId: ''");
    expect(resolver).toContain("integrationService: ''");
    expect(resolver).toContain('integrationOwnerId,');
    expect(resolver).toContain('integrationService,');
  });

  it('updates the selected canonical integration owner rather than the authenticated requester', () => {
    const start = api.indexOf("if (service === 'meta') {");
    const end = api.indexOf("const { data: cred }", start);
    const source = api.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(source).toContain("const integrationOwnerId = creds.integrationOwnerId ?? '';");
    expect(source).toContain("const integrationService = creds.integrationService ?? '';");
    expect(source).toContain('updateIntegrationStatus(adminClient, integrationOwnerId, integrationService');
    expect(source).not.toContain("updateIntegrationStatus(adminClient, userId, 'meta'");
  });

  it('scopes organic and Instagram persisted reads to clinic when the requester has one', () => {
    const organic = api.slice(api.indexOf('async function handleMetaOrganicGet'), api.indexOf('async function handleMetaIgGet'));
    const ig = api.slice(api.indexOf('async function handleMetaIgGet'), api.indexOf('function parseMetaBackfillDates'));
    expect(organic).toContain('resolveMetaIntegration(adminClient, userId');
    expect(organic).toContain('applyClinicOrUserScope(query, requesterClinicId, userId)');
    expect(ig).toContain('resolveMetaIntegration(adminClient, userId');
    expect(ig).toContain('applyClinicOrUserScope(query, requesterClinicId, userId)');
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
