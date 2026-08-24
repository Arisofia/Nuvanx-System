#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
  adsetApplyParams,
  adsetDrift,
  adsetRollbackParams,
  buildAdsetContract,
  buildDesiredCreative,
  classifyAdsetDrift,
  creativeMatches,
  normalizeOwnedTargeting,
  same,
  selectedAdsetDrift,
} from './lib/meta-rsv26.js';

const config = JSON.parse(
  await readFile(new URL('../config/meta/rsv26-canonical.json', import.meta.url), 'utf8'),
);

const apply = process.argv.includes('--apply');
const selection = Object.freeze({
  names: process.argv.includes('--apply-names'),
  attribution: process.argv.includes('--apply-attribution'),
  settings: process.argv.includes('--apply-adset-settings'),
  creatives: process.argv.includes('--apply-creatives'),
});
const selectedFamilyCount = Object.values(selection).filter(Boolean).length;
const managementToken = String(
  process.env.META_ADS_MANAGEMENT_TOKEN
  || process.env.META_CANONICAL_ACCESS_TOKEN
  || '',
).trim();
const appSecret = String(process.env.META_CANONICAL_APP_SECRET || '').trim();
const readToken = String(
  managementToken
  || process.env.META_REPORTING_TOKEN_60D
  || '',
).trim();

if (!readToken) {
  console.error('Missing META_REPORTING_TOKEN_60D or canonical Meta token. No writes performed.');
  process.exit(2);
}
if (!apply && selectedFamilyCount > 0) {
  console.error('Mutation-family flags are only valid together with --apply. No writes performed.');
  process.exit(2);
}
if (apply && selectedFamilyCount === 0) {
  console.error('--apply requires at least one explicit mutation family: --apply-names, --apply-attribution, --apply-adset-settings, or --apply-creatives. No writes performed.');
  process.exit(2);
}
if (apply && !managementToken) {
  console.error('Apply mode requires META_ADS_MANAGEMENT_TOKEN or META_CANONICAL_ACCESS_TOKEN. No writes performed.');
  process.exit(2);
}
if (apply && !appSecret) {
  console.error('Apply mode requires META_CANONICAL_APP_SECRET to validate the management token against the canonical app. No writes performed.');
  process.exit(2);
}

const graphBase = `https://graph.facebook.com/${config.graph_version}`;

async function graphRequest(path, { method = 'GET', params = {}, token = readToken } = {}) {
  const url = new URL(`${graphBase}/${String(path).replace(/^\//, '')}`);
  const payload = new URLSearchParams();
  const target = method === 'GET' ? url.searchParams : payload;
  target.set('access_token', token);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    target.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  const response = await fetch(url, {
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : payload,
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    const error = body?.error ?? {};
    throw new Error(`${method} ${path}: ${error.message ?? `Meta HTTP ${response.status}`} (code=${error.code ?? '?'}, sub=${error.error_subcode ?? '?'})`);
  }
  return body;
}

async function requireManagementScope() {
  const appAccessToken = `${config.app_id}|${appSecret}`;
  const debug = await graphRequest('debug_token', {
    params: { input_token: managementToken },
    token: appAccessToken,
  });
  const data = debug?.data ?? {};
  if (!data.is_valid) {
    throw new Error('Canonical Meta token is invalid. No writes performed.');
  }
  if (String(data.app_id ?? '') !== String(config.app_id)) {
    throw new Error(`Management token belongs to app ${data.app_id ?? 'unknown'}, expected canonical app ${config.app_id}. No writes performed.`);
  }

  const permissions = await graphRequest('me/permissions', { token: managementToken });
  const granted = new Set(
    Array.isArray(permissions?.data)
      ? permissions.data.filter((row) => row?.status === 'granted').map((row) => String(row.permission))
      : [],
  );
  if (!granted.has('ads_management')) {
    throw new Error('Canonical Meta token does not include ads_management. No writes performed.');
  }

  const identity = {
    app_id: data.app_id ?? null,
    user_id: data.user_id ?? null,
    token_type: data.type ?? null,
    permissions: [...granted].sort(),
  };
  if (config.preferred_system_user_id && String(identity.user_id ?? '') !== String(config.preferred_system_user_id)) {
    throw new Error(`Management token user_id=${identity.user_id ?? 'unknown'} differs from canonical System User ${config.preferred_system_user_id}. No writes performed.`);
  }
  return identity;
}

const ADSET_FIELDS = 'id,name,status,effective_status,daily_budget,attribution_spec,optimization_goal,billing_event,bid_strategy,targeting';
const AD_FIELDS = 'id,name,status,effective_status,adset_id,creative{id,name,asset_feed_spec,object_story_spec,degrees_of_freedom_spec,url_tags}';

async function readCampaign(token = readToken) {
  return graphRequest(config.campaign.id, {
    params: { fields: 'id,name,status,effective_status,objective' },
    token,
  });
}

async function readAdset(item, token = readToken) {
  return graphRequest(item.adset_id, { params: { fields: ADSET_FIELDS }, token });
}

async function readAd(item, token = readToken) {
  return graphRequest(item.ad_id, { params: { fields: AD_FIELDS }, token });
}

async function readItem(item, token = readToken) {
  const [adset, ad, sourceCreative] = await Promise.all([
    readAdset(item, token),
    readAd(item, token),
    graphRequest(item.source_creative_id, {
      params: {
        fields: 'id,name,asset_feed_spec,object_story_spec,degrees_of_freedom_spec,url_tags',
      },
      token,
    }),
  ]);

  if (String(ad?.adset_id ?? '') !== String(item.adset_id)) {
    throw new Error(`${item.key}: ad ${item.ad_id} belongs to adset ${ad?.adset_id ?? 'unknown'}, expected ${item.adset_id}`);
  }
  const desiredCreative = buildDesiredCreative(sourceCreative, item, config.defaults);
  const adsetContract = buildAdsetContract(adset, item, config.defaults);
  return { item, adset, ad, sourceCreative, desiredCreative, adsetContract };
}

async function readSnapshot(token = readToken) {
  const campaign = await readCampaign(token);
  const items = [];
  for (const item of config.adsets) items.push(await readItem(item, token));
  return { campaign, items };
}

function campaignDrift(campaign) {
  const drift = [];
  if (String(campaign?.name ?? '') !== String(config.campaign.name)) drift.push('name');
  if (String(campaign?.status ?? '') !== String(config.campaign.status)) drift.push('status');
  if (String(campaign?.objective ?? '') !== String(config.campaign.objective)) drift.push('objective');
  return drift;
}

function itemDrift(entry) {
  const drift = adsetDrift(entry.adsetContract).map((field) => `adset.${field}`);
  if (String(entry.ad?.name ?? '') !== String(entry.item.ad_name)) drift.push('ad.name');
  if (!creativeMatches(entry.ad?.creative ?? {}, entry.desiredCreative)) drift.push('ad.creative');
  return drift;
}

function classifyItemDrift(entry) {
  const adsetFields = adsetDrift(entry.adsetContract);
  const adset = classifyAdsetDrift(adsetFields);
  return {
    names: [
      ...adset.names.map((field) => `adset.${field}`),
      ...(String(entry.ad?.name ?? '') !== String(entry.item.ad_name) ? ['ad.name'] : []),
    ],
    attribution: adset.attribution.map((field) => `adset.${field}`),
    adset_settings: adset.settings.map((field) => `adset.${field}`),
    creatives: creativeMatches(entry.ad?.creative ?? {}, entry.desiredCreative) ? [] : ['ad.creative'],
  };
}

function buildPlan(snapshot) {
  const campaignFields = campaignDrift(snapshot.campaign);
  return {
    campaign: {
      id: config.campaign.id,
      current_status: snapshot.campaign?.status ?? null,
      drift: campaignFields,
      mutation_groups: {
        names: campaignFields.includes('name') ? ['campaign.name'] : [],
        unsupported: campaignFields.filter((field) => field !== 'name').map((field) => `campaign.${field}`),
      },
    },
    adsets: snapshot.items.map((entry) => ({
      key: entry.item.key,
      adset_id: entry.item.adset_id,
      ad_id: entry.item.ad_id,
      source_creative_id: entry.item.source_creative_id,
      current_creative_id: entry.ad?.creative?.id ?? null,
      drift: itemDrift(entry),
      mutation_groups: classifyItemDrift(entry),
    })),
  };
}

function planHasDrift(plan) {
  return plan.campaign.drift.length > 0 || plan.adsets.some((item) => item.drift.length > 0);
}

function selectedPlanDrift(plan) {
  const selected = [];
  if (selection.names) selected.push(...plan.campaign.mutation_groups.names);
  for (const item of plan.adsets) {
    if (selection.names) selected.push(...item.mutation_groups.names.map((field) => `${item.key}:${field}`));
    if (selection.attribution) selected.push(...item.mutation_groups.attribution.map((field) => `${item.key}:${field}`));
    if (selection.settings) selected.push(...item.mutation_groups.adset_settings.map((field) => `${item.key}:${field}`));
    if (selection.creatives) selected.push(...item.mutation_groups.creatives.map((field) => `${item.key}:${field}`));
  }
  return selected;
}

function selectFields(params, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(params, field)).map((field) => [field, params[field]]));
}

function comparableAdsetField(contract, field) {
  if (field === 'targeting') return normalizeOwnedTargeting(contract.actual.targeting);
  return contract.actual[field];
}

async function assertCampaignNameUnchanged(initialCampaign) {
  const fresh = await readCampaign(managementToken);
  if (String(fresh?.name ?? '') !== String(initialCampaign?.name ?? '')) {
    throw new Error(`Concurrent campaign change detected before mutation: name changed from ${initialCampaign?.name ?? 'unknown'} to ${fresh?.name ?? 'unknown'}. No selected write performed.`);
  }
}

async function assertAdsetUnchanged(entry, fields) {
  const freshAdset = await readAdset(entry.item, managementToken);
  const freshContract = buildAdsetContract(freshAdset, entry.item, config.defaults);
  for (const field of fields) {
    if (!same(comparableAdsetField(entry.adsetContract, field), comparableAdsetField(freshContract, field))) {
      throw new Error(`${entry.item.key}: concurrent ad-set change detected for ${field}; aborting before overwrite.`);
    }
  }
}

async function assertAdUnchanged(entry, { checkName, checkCreative }) {
  const freshAd = await readAd(entry.item, managementToken);
  if (checkName && String(freshAd?.name ?? '') !== String(entry.ad?.name ?? '')) {
    throw new Error(`${entry.item.key}: concurrent ad-name change detected; aborting before overwrite.`);
  }
  if (checkCreative && String(freshAd?.creative?.id ?? '') !== String(entry.ad?.creative?.id ?? '')) {
    throw new Error(`${entry.item.key}: concurrent creative assignment detected; aborting before overwrite.`);
  }
}

async function assertSourceCreativeUnchanged(entry) {
  const freshSource = await graphRequest(entry.item.source_creative_id, {
    params: { fields: 'id,name,asset_feed_spec,object_story_spec,degrees_of_freedom_spec,url_tags' },
    token: managementToken,
  });
  const freshDesired = buildDesiredCreative(freshSource, entry.item, config.defaults);
  if (!creativeMatches(freshDesired, entry.desiredCreative)) {
    throw new Error(`${entry.item.key}: concurrent source creative change detected; aborting before overwrite.`);
  }
}

function creativeCreateParams(entry, runId) {
  const desired = entry.desiredCreative;
  return {
    name: `RSV26 | ${entry.item.key} | canonical | ${runId}`,
    asset_feed_spec: desired.asset_feed_spec,
    object_story_spec: desired.object_story_spec,
    degrees_of_freedom_spec: desired.degrees_of_freedom_spec || undefined,
    url_tags: desired.url_tags || undefined,
  };
}

async function deleteStagedCreative(creativeId) {
  try {
    await graphRequest(creativeId, { method: 'DELETE', token: managementToken });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function inspectStagedCreativeReference(entry, creativeId) {
  try {
    const freshAd = await readAd(entry.item, managementToken);
    return {
      verified: true,
      referenced: String(freshAd?.creative?.id ?? '') === String(creativeId),
      current_creative_id: freshAd?.creative?.id ? String(freshAd.creative.id) : null,
      error: null,
    };
  } catch (error) {
    return {
      verified: false,
      referenced: null,
      current_creative_id: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function restoreOriginalStatusSafely(originalStatus) {
  const fresh = await readCampaign(managementToken);
  if (String(fresh?.status ?? '') !== 'PAUSED') {
    return {
      restored: false,
      reason: 'campaign_status_changed_concurrently',
      current_status: fresh?.status ?? null,
    };
  }
  await graphRequest(config.campaign.id, {
    method: 'POST',
    params: { status: originalStatus },
    token: managementToken,
  });
  return { restored: true, reason: null, current_status: originalStatus };
}

const initialSnapshot = await readSnapshot();
const initialPlan = buildPlan(initialSnapshot);
console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  selected_mutation_families: selection,
  plan: initialPlan,
}, null, 2));

if (!apply) {
  console.log('Dry-run completed with read-only access. Live writes require --apply plus one or more explicit mutation-family flags.');
  process.exit(0);
}

if (initialPlan.campaign.drift.includes('objective')) {
  throw new Error(`Campaign objective is ${initialSnapshot.campaign?.objective ?? 'unknown'}, expected ${config.campaign.objective}; objective reconciliation is never attempted in-place.`);
}

const selectedInitialDrift = selectedPlanDrift(initialPlan);
const identity = await requireManagementScope();
if (selectedInitialDrift.length === 0) {
  console.log(JSON.stringify({
    success: true,
    changed: false,
    identity,
    selected_mutation_families: selection,
    message: 'No drift exists in the selected mutation families. Unselected drift, if any, remains untouched.',
    remaining_plan: initialPlan,
  }, null, 2));
  process.exit(0);
}

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const stagedCreatives = new Map();
const rollbackOps = [];
const originalCampaign = {
  name: initialSnapshot.campaign?.name ?? config.campaign.name,
  status: initialSnapshot.campaign?.status ?? 'PAUSED',
};
const materialMutationSelected = selection.attribution || selection.settings || selection.creatives;
const temporarilyPause = materialMutationSelected && String(originalCampaign.status) !== 'PAUSED';
let statusPauseOwned = false;

try {
  if (selection.creatives) {
    for (const entry of initialSnapshot.items) {
      if (creativeMatches(entry.ad?.creative ?? {}, entry.desiredCreative)) continue;
      await assertAdUnchanged(entry, { checkName: false, checkCreative: true });
      await assertSourceCreativeUnchanged(entry);
      const created = await graphRequest(`${config.ad_account_id}/adcreatives`, {
        method: 'POST',
        params: creativeCreateParams(entry, runId),
        token: managementToken,
      });
      if (!created?.id) throw new Error(`${entry.item.key}: Meta did not return a staged creative id`);
      stagedCreatives.set(entry.item.key, String(created.id));
    }
  }

  if (temporarilyPause) {
    const freshCampaign = await readCampaign(managementToken);
    if (String(freshCampaign?.status ?? '') !== String(originalCampaign.status)) {
      throw new Error(`Concurrent campaign status change detected before pause: ${originalCampaign.status} -> ${freshCampaign?.status ?? 'unknown'}.`);
    }
    await graphRequest(config.campaign.id, {
      method: 'POST',
      params: { status: 'PAUSED' },
      token: managementToken,
    });
    statusPauseOwned = true;
  }

  if (selection.names && String(initialSnapshot.campaign?.name ?? '') !== String(config.campaign.name)) {
    await assertCampaignNameUnchanged(initialSnapshot.campaign);
    await graphRequest(config.campaign.id, {
      method: 'POST',
      params: { name: config.campaign.name },
      token: managementToken,
    });
    rollbackOps.push({ type: 'campaign-name', id: config.campaign.id, params: { name: originalCampaign.name } });
  }

  for (const entry of initialSnapshot.items) {
    const allDrift = adsetDrift(entry.adsetContract);
    const fields = selectedAdsetDrift(allDrift, {
      names: selection.names,
      attribution: selection.attribution,
      settings: selection.settings,
    });
    if (fields.length === 0) continue;
    await assertAdsetUnchanged(entry, fields);
    const desiredParams = adsetApplyParams(entry.adsetContract);
    const rollbackParams = adsetRollbackParams(entry.adsetContract);
    await graphRequest(entry.item.adset_id, {
      method: 'POST',
      params: selectFields(desiredParams, fields),
      token: managementToken,
    });
    rollbackOps.push({
      type: 'adset',
      id: entry.item.adset_id,
      params: selectFields(rollbackParams, fields),
    });
  }

  for (const entry of initialSnapshot.items) {
    const creativeId = selection.creatives ? stagedCreatives.get(entry.item.key) : null;
    const nameDrift = selection.names && String(entry.ad?.name ?? '') !== String(entry.item.ad_name);
    if (!creativeId && !nameDrift) continue;
    await assertAdUnchanged(entry, { checkName: nameDrift, checkCreative: Boolean(creativeId) });
    const params = {};
    if (nameDrift) params.name = entry.item.ad_name;
    if (creativeId) params.creative = { creative_id: creativeId };
    await graphRequest(entry.item.ad_id, { method: 'POST', params, token: managementToken });
    rollbackOps.push({
      type: 'ad',
      id: entry.item.ad_id,
      key: entry.item.key,
      params: {
        name: nameDrift ? (entry.ad?.name ?? entry.item.ad_name) : undefined,
        creative: creativeId && entry.ad?.creative?.id ? { creative_id: String(entry.ad.creative.id) } : undefined,
      },
    });
  }

  const pausedSnapshot = await readSnapshot(managementToken);
  const pausedPlan = buildPlan(pausedSnapshot);
  const selectedPausedDrift = selectedPlanDrift(pausedPlan);
  if (selectedPausedDrift.length > 0) {
    throw new Error(`Selected mutation families failed verification before status restoration: ${JSON.stringify(selectedPausedDrift)}`);
  }

  if (statusPauseOwned) {
    const restoration = await restoreOriginalStatusSafely(originalCampaign.status);
    if (!restoration.restored) {
      throw new Error(`Refusing to overwrite concurrent campaign status change: ${JSON.stringify(restoration)}`);
    }
    statusPauseOwned = false;
  }

  const finalSnapshot = await readSnapshot(managementToken);
  const finalPlan = buildPlan(finalSnapshot);
  const selectedFinalDrift = selectedPlanDrift(finalPlan);
  if (selectedFinalDrift.length > 0) {
    throw new Error(`Selected mutation families failed final verification: ${JSON.stringify(selectedFinalDrift)}`);
  }

  console.log(JSON.stringify({
    success: true,
    changed: true,
    identity,
    campaign_id: config.campaign.id,
    selected_mutation_families: selection,
    staged_creatives: Object.fromEntries(stagedCreatives),
    final_plan: finalPlan,
    remaining_unselected_drift: planHasDrift(finalPlan),
  }, null, 2));
} catch (error) {
  const rollbackErrors = [];
  for (const operation of rollbackOps.reverse()) {
    try {
      const params = Object.fromEntries(Object.entries(operation.params).filter(([, value]) => value !== undefined));
      await graphRequest(operation.id, { method: 'POST', params, token: managementToken });
    } catch (rollbackError) {
      rollbackErrors.push({
        type: operation.type,
        id: operation.id,
        key: operation.key ?? null,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }
  }

  if (temporarilyPause && !statusPauseOwned) {
    try {
      const freshCampaign = await readCampaign(managementToken);
      if (String(freshCampaign?.status ?? '') === 'PAUSED') {
        statusPauseOwned = true;
      }
    } catch (ignore) {}
  }

  if (statusPauseOwned) {
    try {
      const restoration = await restoreOriginalStatusSafely(originalCampaign.status);
      if (!restoration.restored) rollbackErrors.push({ type: 'campaign-status', id: config.campaign.id, ...restoration });
    } catch (rollbackError) {
      rollbackErrors.push({
        type: 'campaign-status',
        id: config.campaign.id,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }
  }

  const stagedCleanup = [];
  for (const [key, creativeId] of stagedCreatives) {
    const entry = initialSnapshot.items.find((candidate) => candidate.item.key === key);
    if (!entry) {
      stagedCleanup.push({ key, creative_id: creativeId, deleted: false, retained: true, reason: 'entry_not_found' });
      continue;
    }
    const reference = await inspectStagedCreativeReference(entry, creativeId);
    if (!reference.verified || reference.referenced) {
      stagedCleanup.push({
        key,
        creative_id: creativeId,
        deleted: false,
        retained: true,
        reason: reference.referenced ? 'still_referenced_by_live_ad' : 'reference_state_unverified',
        current_creative_id: reference.current_creative_id,
        error: reference.error,
      });
      continue;
    }
    const cleanupError = await deleteStagedCreative(creativeId);
    stagedCleanup.push({
      key,
      creative_id: creativeId,
      deleted: cleanupError === null,
      retained: cleanupError !== null,
      reason: cleanupError === null ? null : 'delete_failed',
      error: cleanupError,
    });
  }

  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error),
    rollback_errors: rollbackErrors,
    staged_cleanup: stagedCleanup,
  }, null, 2));
  process.exit(1);
}
