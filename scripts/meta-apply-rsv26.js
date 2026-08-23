#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

const config = JSON.parse(
  await readFile(new URL('../config/meta/rsv26-canonical.json', import.meta.url), 'utf8'),
);
const apply = process.argv.includes('--apply');
const token = String(
  process.env.META_ADS_MANAGEMENT_TOKEN
  || process.env.META_CANONICAL_ACCESS_TOKEN
  || '',
).trim();

if (!token) {
  console.error('Missing META_ADS_MANAGEMENT_TOKEN or META_CANONICAL_ACCESS_TOKEN. No writes performed.');
  process.exit(2);
}

const graphBase = `https://graph.facebook.com/${config.graph_version}`;

async function graphRequest(path, { method = 'GET', params = {} } = {}) {
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
  const debug = await graphRequest('debug_token', { params: { input_token: token } });
  const data = debug?.data ?? {};
  const scopes = new Set(Array.isArray(data.scopes) ? data.scopes : []);
  if (!data.is_valid || !scopes.has('ads_management')) {
    throw new Error('Canonical Meta token is invalid or does not include ads_management. No writes performed.');
  }
  return { app_id: data.app_id ?? null, user_id: data.user_id ?? null, scopes: [...scopes].sort() };
}

function firstText(items) {
  const item = Array.isArray(items) ? items[0] : null;
  return typeof item?.text === 'string' ? item.text.trim() : '';
}

function replaceCreativeText(assetFeedSpec, item) {
  const cloned = structuredClone(assetFeedSpec ?? {});
  if (!Array.isArray(cloned.bodies) || cloned.bodies.length === 0) {
    throw new Error(`${item.key}: source creative has no asset_feed_spec.bodies`);
  }
  if (!Array.isArray(cloned.titles) || cloned.titles.length === 0) {
    throw new Error(`${item.key}: source creative has no asset_feed_spec.titles`);
  }
  for (const body of cloned.bodies) body.text = item.body;
  for (const title of cloned.titles) title.text = item.headline;
  if (Array.isArray(cloned.descriptions) && cloned.descriptions.length > 0) {
    for (const description of cloned.descriptions) description.text = item.description;
  } else {
    cloned.descriptions = [{ text: item.description }];
  }
  return cloned;
}

function creativeMatches(creative, item) {
  const asset = creative?.asset_feed_spec ?? {};
  return firstText(asset.bodies) === item.body
    && firstText(asset.titles) === item.headline
    && firstText(asset.descriptions) === item.description;
}

const identity = await requireManagementScope();
const snapshot = [];

for (const item of config.adsets) {
  const [adset, ad] = await Promise.all([
    graphRequest(item.adset_id, {
      params: { fields: 'id,name,status,effective_status,daily_budget,attribution_spec' },
    }),
    graphRequest(item.ad_id, {
      params: { fields: 'id,name,status,effective_status,adset_id,creative{id,name,asset_feed_spec,object_story_spec}' },
    }),
  ]);
  snapshot.push({ item, adset, ad });
}

const plan = snapshot.map(({ item, adset, ad }) => ({
  key: item.key,
  adset_id: item.adset_id,
  ad_id: item.ad_id,
  budget: { current: Number(adset.daily_budget ?? 0), desired: config.defaults.daily_budget_minor },
  attribution: { current: adset.attribution_spec ?? [], desired: config.defaults.attribution_spec },
  adset_name: { current: adset.name ?? '', desired: item.adset_name },
  ad_name: { current: ad.name ?? '', desired: item.ad_name },
  copy_matches: creativeMatches(ad?.creative ?? {}, item),
  current_creative_id: ad?.creative?.id ?? null,
}));

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', identity, plan }, null, 2));
if (!apply) {
  console.log('Dry-run only. Re-run with --apply after reviewing the plan.');
  process.exit(0);
}

// Stage every replacement creative first. Creating a creative does not change live delivery.
const stagedCreatives = new Map();
for (const { item, ad } of snapshot) {
  const currentCreative = ad?.creative ?? {};
  if (creativeMatches(currentCreative, item)) continue;

  const assetFeedSpec = replaceCreativeText(currentCreative.asset_feed_spec, item);
  const objectStorySpec = structuredClone(currentCreative.object_story_spec ?? {});
  objectStorySpec.page_id = config.defaults.page_id;
  objectStorySpec.instagram_user_id = config.defaults.instagram_user_id;

  const created = await graphRequest(`${config.ad_account_id}/adcreatives`, {
    method: 'POST',
    params: {
      name: `RSV26 | ${item.key} | canonical | ${new Date().toISOString()}`,
      asset_feed_spec: assetFeedSpec,
      object_story_spec: objectStorySpec,
    },
  });
  if (!created?.id) throw new Error(`${item.key}: Meta did not return a creative id`);
  stagedCreatives.set(item.key, String(created.id));
}

// Reconcile adsets first: budget, attribution and naming.
for (const { item } of snapshot) {
  await graphRequest(item.adset_id, {
    method: 'POST',
    params: {
      name: item.adset_name,
      daily_budget: String(config.defaults.daily_budget_minor),
      attribution_spec: config.defaults.attribution_spec,
    },
  });
}

// Swap ads to the staged creatives and normalize naming.
for (const { item } of snapshot) {
  const params = { name: item.ad_name };
  const creativeId = stagedCreatives.get(item.key);
  if (creativeId) params.creative = { creative_id: creativeId };
  await graphRequest(item.ad_id, { method: 'POST', params });
}

console.log(JSON.stringify({
  success: true,
  campaign_id: config.campaign.id,
  staged_creatives: Object.fromEntries(stagedCreatives),
  daily_budget_total_minor: config.defaults.daily_budget_minor * config.adsets.length,
}, null, 2));
