#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function firstText(items) {
  const item = Array.isArray(items) ? items[0] : null;
  return typeof item?.text === 'string' ? item.text.trim() : '';
}

function leadFormId(assetFeedSpec) {
  const calls = Array.isArray(assetFeedSpec?.call_to_actions) ? assetFeedSpec.call_to_actions : [];
  return String(calls[0]?.value?.lead_gen_form_id ?? '');
}

function targetingSummary(targeting = {}) {
  const interest = targeting?.flexible_spec?.[0]?.interests?.[0] ?? {};
  const place = targeting?.geo_locations?.places?.[0] ?? {};
  return {
    age_min: Number(targeting?.age_min ?? 0),
    age_max: Number(targeting?.age_max ?? 0),
    genders: Array.isArray(targeting?.genders) ? targeting.genders.map(Number) : [],
    interest_id: String(interest?.id ?? ''),
    location_key: String(place?.key ?? ''),
    radius_km: Number(place?.radius ?? 0),
  };
}

const report = {
  generated_at: new Date().toISOString(),
  campaign: null,
  adsets: [],
  drift_count: 0,
  drift: [],
};

const campaign = await graphGet(config.campaign.id, {
  fields: 'id,name,status,effective_status,objective',
});
report.campaign = campaign;

for (const [field, expected] of Object.entries({
  name: config.campaign.name,
  status: config.campaign.status,
  objective: config.campaign.objective,
})) {
  if (String(campaign[field] ?? '') !== String(expected)) {
    report.drift.push({ scope: 'campaign', id: config.campaign.id, field, expected, actual: campaign[field] ?? null });
  }
}

const expectedTargeting = {
  age_min: config.defaults.targeting.age_min,
  age_max: config.defaults.targeting.age_max,
  genders: config.defaults.targeting.genders,
  interest_id: config.defaults.targeting.interest_id,
  location_key: config.defaults.targeting.location_key,
  radius_km: config.defaults.targeting.radius_km,
};

for (const item of config.adsets) {
  const [adset, ad] = await Promise.all([
    graphGet(item.adset_id, {
      fields: 'id,name,status,effective_status,daily_budget,attribution_spec,optimization_goal,billing_event,bid_strategy,targeting',
    }),
    graphGet(item.ad_id, {
      fields: 'id,name,status,effective_status,adset_id,creative{id,name,asset_feed_spec,object_story_spec}',
    }),
  ]);

  const creative = ad?.creative ?? {};
  const asset = creative?.asset_feed_spec ?? {};
  const actual = {
    adset_name: adset.name ?? '',
    daily_budget_minor: Number(adset.daily_budget ?? 0),
    attribution_spec: adset.attribution_spec ?? [],
    optimization_goal: adset.optimization_goal ?? '',
    billing_event: adset.billing_event ?? '',
    bid_strategy: adset.bid_strategy ?? '',
    targeting: targetingSummary(adset.targeting),
    ad_name: ad.name ?? '',
    body: firstText(asset.bodies),
    headline: firstText(asset.titles),
    description: firstText(asset.descriptions),
    lead_gen_form_id: leadFormId(asset),
    page_id: String(creative?.object_story_spec?.page_id ?? ''),
    instagram_user_id: String(creative?.object_story_spec?.instagram_user_id ?? ''),
    creative_id: String(creative?.id ?? ''),
  };

  const expected = {
    adset_name: item.adset_name,
    daily_budget_minor: config.defaults.daily_budget_minor,
    attribution_spec: config.defaults.attribution_spec,
    optimization_goal: config.defaults.optimization_goal,
    billing_event: config.defaults.billing_event,
    bid_strategy: config.defaults.bid_strategy,
    targeting: expectedTargeting,
    ad_name: item.ad_name,
    body: item.body,
    headline: item.headline,
    description: item.description,
    lead_gen_form_id: config.defaults.lead_gen_form_id,
    page_id: config.defaults.page_id,
    instagram_user_id: config.defaults.instagram_user_id,
  };

  const itemDrift = [];
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (!same(actual[field], expectedValue)) {
      itemDrift.push({ field, expected: expectedValue, actual: actual[field] });
      report.drift.push({ scope: item.key, id: item.adset_id, field, expected: expectedValue, actual: actual[field] });
    }
  }

  report.adsets.push({ key: item.key, adset_id: item.adset_id, ad_id: item.ad_id, actual, drift: itemDrift });
}

report.drift_count = report.drift.length;
console.log(JSON.stringify(report, null, 2));

if (report.drift_count > 0) process.exitCode = 1;
