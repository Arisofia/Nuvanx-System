#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
  adsetDrift,
  buildAdsetContract,
  buildDesiredCreative,
  creativeContract,
  creativeMatches,
  normalizeOwnedTargeting,
} from './lib/meta-rsv26.js';

const config = JSON.parse(
  await readFile(new URL('../config/meta/rsv26-canonical.json', import.meta.url), 'utf8'),
);
const token = String(
  process.env.META_REPORTING_TOKEN_60D
  || process.env.META_ADS_MANAGEMENT_TOKEN
  || process.env.META_CANONICAL_ACCESS_TOKEN
  || '',
).trim();

if (!token) {
  console.error('Missing META_REPORTING_TOKEN_60D or canonical Meta token.');
  process.exit(2);
}

const graphBase = `https://graph.facebook.com/${config.graph_version}`;

async function graphGet(path, params = {}) {
  const url = new URL(`${graphBase}/${String(path).replace(/^\//, '')}`);
  url.searchParams.set('access_token', token);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    const error = body?.error ?? {};
    throw new Error(`${path}: ${error.message ?? `Meta HTTP ${response.status}`} (code=${error.code ?? '?'}, sub=${error.error_subcode ?? '?'})`);
  }
  return body;
}

const report = {
  generated_at: new Date().toISOString(),
  campaign: null,
  campaign_ads: [],
  adsets: [],
  drift_count: 0,
  drift: [],
};

const [campaign, campaignAdsPage] = await Promise.all([
  graphGet(config.campaign.id, {
    fields: 'id,name,status,effective_status,objective',
  }),
  graphGet(`${config.campaign.id}/ads`, {
    fields: 'id,name,status,effective_status,adset_id',
    limit: 500,
  }),
]);
report.campaign = campaign;
report.campaign_ads = Array.isArray(campaignAdsPage?.data) ? campaignAdsPage.data : [];

for (const [field, expected] of Object.entries({
  name: config.campaign.name,
  status: config.campaign.status,
  objective: config.campaign.objective,
})) {
  if (String(campaign[field] ?? '') !== String(expected)) {
    report.drift.push({ scope: 'campaign', id: config.campaign.id, field, expected, actual: campaign[field] ?? null });
  }
}

const governedAdIds = new Set(config.adsets.map((item) => String(item.ad_id)));
const retiredStatuses = new Set(['ARCHIVED', 'DELETED']);
for (const ad of report.campaign_ads) {
  const adId = String(ad?.id ?? '');
  if (!adId || governedAdIds.has(adId)) continue;
  const status = String(ad?.status ?? '').toUpperCase();
  const effectiveStatus = String(ad?.effective_status ?? '').toUpperCase();
  if (retiredStatuses.has(status) || retiredStatuses.has(effectiveStatus)) continue;
  report.drift.push({
    scope: 'campaign_inventory',
    id: adId,
    field: 'unexpected_ad',
    expected: [...governedAdIds].sort(),
    actual: {
      name: ad?.name ?? null,
      status: ad?.status ?? null,
      effective_status: ad?.effective_status ?? null,
      adset_id: ad?.adset_id ?? null,
    },
  });
}

for (const item of config.adsets) {
  const [adset, ad, sourceCreative] = await Promise.all([
    graphGet(item.adset_id, {
      fields: 'id,name,status,effective_status,daily_budget,attribution_spec,optimization_goal,billing_event,bid_strategy,targeting',
    }),
    graphGet(item.ad_id, {
      fields: 'id,name,status,effective_status,adset_id,creative{id,name,asset_feed_spec,object_story_spec,degrees_of_freedom_spec,url_tags}',
    }),
    graphGet(item.source_creative_id, {
      fields: 'id,name,asset_feed_spec,object_story_spec,degrees_of_freedom_spec,url_tags',
    }),
  ]);

  if (String(ad?.adset_id ?? '') !== String(item.adset_id)) {
    report.drift.push({
      scope: item.key,
      id: item.ad_id,
      field: 'adset_id',
      expected: item.adset_id,
      actual: ad?.adset_id ?? null,
    });
  }

  const adsetContract = buildAdsetContract(adset, item, config.defaults);
  const desiredCreative = buildDesiredCreative(sourceCreative, item, config.defaults);
  const currentCreative = ad?.creative ?? {};
  const itemDrift = [];

  for (const field of adsetDrift(adsetContract)) {
    const expected = field === 'targeting'
      ? normalizeOwnedTargeting(adsetContract.desired.targeting)
      : adsetContract.desired[field];
    const actual = field === 'targeting'
      ? normalizeOwnedTargeting(adsetContract.actual.targeting)
      : adsetContract.actual[field];
    const drift = { field: `adset.${field}`, expected, actual };
    itemDrift.push(drift);
    report.drift.push({ scope: item.key, id: item.adset_id, ...drift });
  }

  if (String(ad?.name ?? '') !== String(item.ad_name)) {
    const drift = { field: 'ad.name', expected: item.ad_name, actual: ad?.name ?? '' };
    itemDrift.push(drift);
    report.drift.push({ scope: item.key, id: item.ad_id, ...drift });
  }

  if (!creativeMatches(currentCreative, desiredCreative)) {
    const drift = {
      field: 'ad.creative',
      expected: creativeContract(desiredCreative),
      actual: creativeContract(currentCreative),
    };
    itemDrift.push(drift);
    report.drift.push({ scope: item.key, id: item.ad_id, ...drift });
  }

  report.adsets.push({
    key: item.key,
    adset_id: item.adset_id,
    ad_id: item.ad_id,
    source_creative_id: item.source_creative_id,
    current_creative_id: String(currentCreative?.id ?? ''),
    drift: itemDrift,
  });
}

report.drift_count = report.drift.length;
console.log(JSON.stringify(report, null, 2));

if (report.drift_count > 0) process.exitCode = 1;
