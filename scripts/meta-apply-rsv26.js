#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
  adsetApplyParams,
  adsetDrift,
  adsetRollbackParams,
  buildAdsetContract,
  buildDesiredCreative,
  creativeMatches,
} from './lib/meta-rsv26.js';

const config = JSON.parse(
  await readFile(new URL('../config/meta/rsv26-canonical.json', import.meta.url), 'utf8'),
);
const apply = process.argv.includes('--apply');
const applyCreatives = process.argv.includes('--apply-creatives');
const managementToken = String(
  process.env.META_ADS_MANAGEMENT_TOKEN
  || process.env.META_CANONICAL_ACCESS_TOKEN
  || '',
).trim();
const readToken = String(
  managementToken
  || process.env.META_REPORTING_TOKEN_60D
  || '',
).trim();

if (!readToken) {
  console.error('Missing META_REPORTING_TOKEN_60D or canonical Meta token. No writes performed.');
  process.exit(2);
}
if (!apply && applyCreatives) {
  console.error('--apply-creatives is only valid together with --apply. No writes performed.');
  process.exit(2);
}
if (apply && !managementToken) {
  console.error('Apply mode requires META_ADS_MANAGEMENT_TOKEN or META_CANONICAL_ACCESS_TOKEN. No writes performed.');
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
  const debug = await graphRequest('debug_token', {
    params: { input_token: managementToken },
    token: managementToken,
  });
  const data = debug?.data ?? {};
  const scopes = new Set(Array.isArray(data.scopes) ? data.scopes : []);
  if (!data.is_valid || !scopes.has('ads_management')) {
    throw new Error('Canonical Meta token is invalid or does not include ads_management. No writes performed.');
  }
  if (String(data.app_id ?? '') !== String(config.app_id)) {
    throw new Error(`Management token belongs to app ${data.app_id ?? 'unknown'}, expected canonical app ${config.app_id}. No writes performed.`);
  }
  const identity = {
    app_id: data.app_id ?? null,
    user_id: data.user_id ?? null,
    scopes: [...scopes].sort(),
  };
  if (config.preferred_system_user_id && String(identity.user_id ?? '') !== String(config.preferred_system_user_id)) {
    console.warn(`Management token user_id=${identity.user_id ?? 'unknown'} differs from preferred system user ${config.preferred_system_user_id}.`);
  }
  return identity;
}

async function readCampaign(token = readToken) {
  return graphRequest(config.campaign.id, {
    params: { fields: 'id,name,status,effective_status,objective' },
    token,
  });
}

async function readItem(item, token = readToken) {
  const [adset, ad, sourceCreative] = await Promise.all([
    graphRequest(item.adset_id, {
      params: {
        fields: 'id,name,status,effective_status,daily_budget,attribution_spec,optimization_goal,billing_event,bid_strategy,targeting',
      },
      token,
    }),
    graphRequest(item.ad_id, {
      params: {
        fields: 'id,name,status,effective_status,adset_id,creative{id,name,asset_feed_spec,object_story_spec,degrees_of_freedom_spec,url_tags}',
      },
      token,
    }),
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

function campaignDrift(campaign, { ignoreStatus = false } = {}) {
  const drift = [];
  if (String(campaign?.name ?? '') !== String(config.campaign.name)) drift.push('name');
  if (!ignoreStatus && String(campaign?.status ?? '') !== String(config.campaign.status)) drift.push('status');
  if (String(campaign?.objective ?? '') !== String(config.campaign.objective)) drift.push('objective');
  return drift;
}

function itemDrift(entry) {
  const drift = adsetDrift(entry.adsetContract).map((field) => `adset.${field}`);
  if (String(entry.ad?.name ?? '') !== String(entry.item.ad_name)) drift.push('ad.name');
  if (!creativeMatches(entry.ad?.creative ?? {}, entry.desiredCreative)) drift.push('ad.creative');
  return drift;
}

function buildPlan(snapshot, options = {}) {
  return {
    campaign: {
      id: config.campaign.id,
      current_status: snapshot.campaign?.status ?? null,
      drift: campaignDrift(snapshot.campaign, options),
    },
    adsets: snapshot.items.map((entry) => ({
      key: entry.item.key,
      adset_id: entry.item.adset_id,
      ad_id: entry.item.ad_id,
      source_creative_id: entry.item.source_creative_id,
      current_creative_id: entry.ad?.creative?.id ?? null,
      drift: itemDrift(entry),
    })),
  };
}

function planHasDrift(plan) {
  return plan.campaign.drift.length > 0 || plan.adsets.some((item) => item.drift.length > 0);
}

function planHasCreativeDrift(plan) {
  return plan.adsets.some((item) => item.drift.includes('ad.creative'));
}

function selectFields(params, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(params, field)).map((field) => [field, params[field]]));
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

const initialSnapshot = await readSnapshot();
const initialPlan = buildPlan(initialSnapshot);
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', apply_creatives: applyCreatives, plan: initialPlan }, null, 2));

if (!apply) {
  console.log('Dry-run completed with read-only access. Re-run with --apply only after reviewing the plan. Creative swaps additionally require --apply-creatives.');
  process.exit(0);
}

if (initialPlan.campaign.drift.includes('objective')) {
  throw new Error(`Campaign objective is ${initialSnapshot.campaign?.objective ?? 'unknown'}, expected ${config.campaign.objective}; objective reconciliation is not attempted in-place.`);
}
if (planHasCreativeDrift(initialPlan) && !applyCreatives) {
  throw new Error('Creative drift is present. Refusing all writes until the creative differences are reviewed and --apply-creatives is explicitly supplied together with --apply.');
}

const identity = await requireManagementScope();
if (!planHasDrift(initialPlan)) {
  console.log(JSON.stringify({ success: true, changed: false, identity, message: 'RSV26 is already canonical.' }, null, 2));
  process.exit(0);
}

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const stagedCreatives = new Map();
const rollbackOps = [];
const originalCampaign = {
  name: initialSnapshot.campaign?.name ?? config.campaign.name,
  status: initialSnapshot.campaign?.status ?? config.campaign.status,
};

try {
  // Creative changes are separately gated because they replace the live ad payload.
  if (applyCreatives) {
    for (const entry of initialSnapshot.items) {
      if (creativeMatches(entry.ad?.creative ?? {}, entry.desiredCreative)) continue;
      const created = await graphRequest(`${config.ad_account_id}/adcreatives`, {
        method: 'POST',
        params: creativeCreateParams(entry, runId),
        token: managementToken,
      });
      if (!created?.id) throw new Error(`${entry.item.key}: Meta did not return a staged creative id`);
      stagedCreatives.set(entry.item.key, String(created.id));
    }
  }

  // Prevent mixed live delivery while the multi-object reconciliation is in progress.
  if (String(initialSnapshot.campaign?.status ?? '') !== 'PAUSED') {
    await graphRequest(config.campaign.id, {
      method: 'POST',
      params: { status: 'PAUSED' },
      token: managementToken,
    });
  }

  if (String(initialSnapshot.campaign?.name ?? '') !== String(config.campaign.name)) {
    await graphRequest(config.campaign.id, {
      method: 'POST',
      params: { name: config.campaign.name },
      token: managementToken,
    });
  }

  // Reconcile only fields proven to be in drift. Do not resend unchanged budget/targeting/etc.
  for (const entry of initialSnapshot.items) {
    const drift = adsetDrift(entry.adsetContract);
    if (drift.length === 0) continue;
    const desiredParams = adsetApplyParams(entry.adsetContract);
    const rollbackParams = adsetRollbackParams(entry.adsetContract);
    await graphRequest(entry.item.adset_id, {
      method: 'POST',
      params: selectFields(desiredParams, drift),
      token: managementToken,
    });
    rollbackOps.push({
      type: 'adset',
      id: entry.item.adset_id,
      params: selectFields(rollbackParams, drift),
    });
  }

  // Normalize ad names and, only with explicit creative opt-in, swap to staged creatives.
  for (const entry of initialSnapshot.items) {
    const creativeId = stagedCreatives.get(entry.item.key);
    const nameDrift = String(entry.ad?.name ?? '') !== String(entry.item.ad_name);
    if (!creativeId && !nameDrift) continue;
    const params = { name: entry.item.ad_name };
    if (creativeId) params.creative = { creative_id: creativeId };
    await graphRequest(entry.item.ad_id, { method: 'POST', params, token: managementToken });
    rollbackOps.push({
      type: 'ad',
      id: entry.item.ad_id,
      params: {
        name: entry.ad?.name ?? entry.item.ad_name,
        creative: creativeId && entry.ad?.creative?.id ? { creative_id: String(entry.ad.creative.id) } : undefined,
      },
    });
  }

  // Verify the complete contract while delivery remains paused.
  const pausedSnapshot = await readSnapshot(managementToken);
  const pausedPlan = buildPlan(pausedSnapshot, { ignoreStatus: true });
  if (planHasDrift(pausedPlan)) {
    throw new Error(`Post-apply verification failed before reactivation: ${JSON.stringify(pausedPlan)}`);
  }

  await graphRequest(config.campaign.id, {
    method: 'POST',
    params: { status: config.campaign.status },
    token: managementToken,
  });

  const finalSnapshot = await readSnapshot(managementToken);
  const finalPlan = buildPlan(finalSnapshot);
  if (planHasDrift(finalPlan)) {
    throw new Error(`Final verification failed after reactivation: ${JSON.stringify(finalPlan)}`);
  }

  console.log(JSON.stringify({
    success: true,
    changed: true,
    identity,
    campaign_id: config.campaign.id,
    staged_creatives: Object.fromEntries(stagedCreatives),
    daily_budget_total_minor: config.defaults.daily_budget_minor * config.adsets.length,
    final_plan: finalPlan,
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
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }
  }

  try {
    await graphRequest(config.campaign.id, {
      method: 'POST',
      params: { name: originalCampaign.name, status: originalCampaign.status },
      token: managementToken,
    });
  } catch (rollbackError) {
    rollbackErrors.push({
      type: 'campaign',
      id: config.campaign.id,
      error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
    });
  }

  const stagedCleanup = [];
  for (const [key, creativeId] of stagedCreatives) {
    const cleanupError = await deleteStagedCreative(creativeId);
    stagedCleanup.push({ key, creative_id: creativeId, deleted: cleanupError === null, error: cleanupError });
  }

  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error),
    rollback_errors: rollbackErrors,
    staged_cleanup: stagedCleanup,
  }, null, 2));
  process.exit(1);
}
