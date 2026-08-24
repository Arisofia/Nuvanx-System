#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import {
  buildDesiredCreative,
  creativeContract,
  same,
  stable,
} from './lib/meta-rsv26.js';

const config = JSON.parse(
  await readFile(new URL('../config/meta/rsv26-canonical.json', import.meta.url), 'utf8'),
);

const token = String(
  process.env.META_ADS_MANAGEMENT_TOKEN
  || process.env.META_CANONICAL_ACCESS_TOKEN
  || process.env.META_REPORTING_TOKEN_60D
  || '',
).trim();

if (!token) {
  console.error('META_CREATIVE_DIFF=FAIL reason=no_read_token');
  process.exit(2);
}

const graphBase = `https://graph.facebook.com/${config.graph_version}`;

async function graphGet(path, params = {}) {
  const url = new URL(`${graphBase}/${String(path).replace(/^\//, '')}`);
  url.searchParams.set('access_token', token);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    const error = body?.error ?? {};
    throw new Error(`${path}: ${error.message ?? `Meta HTTP ${response.status}`} (code=${error.code ?? '?'}, sub=${error.error_subcode ?? '?'})`);
  }
  return body;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pathJoin(base, key) {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : String(key);
}

function collectDiffs(actual, desired, path = '') {
  if (same(actual, desired)) return [];

  if (Array.isArray(actual) && Array.isArray(desired)) {
    const max = Math.max(actual.length, desired.length);
    const diffs = [];
    for (let i = 0; i < max; i += 1) {
      if (i >= actual.length) {
        diffs.push({ path: pathJoin(path, i), kind: 'missing_actual', actual: undefined, desired: desired[i] });
      } else if (i >= desired.length) {
        diffs.push({ path: pathJoin(path, i), kind: 'extra_actual', actual: actual[i], desired: undefined });
      } else {
        diffs.push(...collectDiffs(actual[i], desired[i], pathJoin(path, i)));
      }
    }
    return diffs;
  }

  if (isPlainObject(actual) && isPlainObject(desired)) {
    const keys = [...new Set([...Object.keys(actual), ...Object.keys(desired)])].sort();
    const diffs = [];
    for (const key of keys) {
      if (!Object.hasOwn(actual, key)) {
        diffs.push({ path: pathJoin(path, key), kind: 'missing_actual', actual: undefined, desired: desired[key] });
      } else if (!Object.hasOwn(desired, key)) {
        diffs.push({ path: pathJoin(path, key), kind: 'extra_actual', actual: actual[key], desired: undefined });
      } else {
        diffs.push(...collectDiffs(actual[key], desired[key], pathJoin(path, key)));
      }
    }
    return diffs;
  }

  return [{ path, kind: 'value', actual, desired }];
}

function compactValue(value) {
  if (value === undefined) return '<undefined>';
  if (value === null) return null;
  if (typeof value === 'string') {
    if (value.length <= 100) return value;
    return `${value.slice(0, 97)}...`;
  }
  if (Array.isArray(value)) {
    if (value.length <= 4) return stable(value);
    return { type: 'array', length: value.length, sample: stable(value.slice(0, 2)) };
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length <= 6) return stable(value);
    return { type: 'object', keys, key_count: keys.length };
  }
  return value;
}

function normalizeEmpty(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (isPlainObject(value) && Object.keys(value).length === 0) return null;
  return value;
}

function classify(diff) {
  const path = diff.path;
  if (same(normalizeEmpty(diff.actual), normalizeEmpty(diff.desired))) return 'SERIALIZATION_ONLY';

  const materialPrefixes = [
    'bodies',
    'titles',
    'descriptions',
    'call_to_action_types',
    'call_to_actions',
    'images',
    'videos',
    'link_urls',
    'page_id',
    'instagram_user_id',
    'link_data',
    'video_data',
    'photo_data',
    'template_data',
    'url_tags',
  ];
  if (materialPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`))) {
    return 'MATERIAL';
  }

  const deliveryPrefixes = [
    'ad_formats',
    'asset_customization_rules',
    'optimization_type',
    'degrees_of_freedom_spec',
  ];
  if (deliveryPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`))) {
    return 'DELIVERY_CONFIGURATION';
  }

  return 'OTHER';
}

function summarizeKinds(diffs) {
  const counts = {};
  for (const diff of diffs) counts[diff.classification] = (counts[diff.classification] ?? 0) + 1;
  return counts;
}

const results = [];

for (const item of config.adsets) {
  const [ad, sourceCreative] = await Promise.all([
    graphGet(item.ad_id, {
      fields: 'id,name,creative{id,name,asset_feed_spec,object_story_spec,degrees_of_freedom_spec,url_tags}',
    }),
    graphGet(item.source_creative_id, {
      fields: 'id,name,asset_feed_spec,object_story_spec,degrees_of_freedom_spec,url_tags',
    }),
  ]);

  const currentCreative = ad?.creative ?? {};
  const desiredCreative = buildDesiredCreative(sourceCreative, item, config.defaults);
  const actualContract = creativeContract(currentCreative);
  const desiredContract = creativeContract(desiredCreative);
  const rawDiffs = collectDiffs(actualContract, desiredContract);
  const diffs = rawDiffs.map((diff) => ({
    path: diff.path,
    kind: diff.kind,
    classification: classify(diff),
    actual: compactValue(diff.actual),
    desired: compactValue(diff.desired),
  }));
  const semanticDiffs = diffs.filter((diff) => diff.classification !== 'SERIALIZATION_ONLY');

  const result = {
    key: item.key,
    ad_id: String(item.ad_id),
    current_creative_id: currentCreative?.id ? String(currentCreative.id) : null,
    source_creative_id: String(item.source_creative_id),
    contract_match: same(actualContract, desiredContract),
    raw_diff_count: diffs.length,
    semantic_diff_count: semanticDiffs.length,
    classification_counts: summarizeKinds(diffs),
    diffs,
  };
  results.push(result);
  console.log(`META_CREATIVE_DIFF_ITEM=${JSON.stringify(result)}`);
}

const totals = {
  items: results.length,
  matching: results.filter((item) => item.contract_match).length,
  drifting: results.filter((item) => !item.contract_match).length,
  raw_diffs: results.reduce((sum, item) => sum + item.raw_diff_count, 0),
  semantic_diffs: results.reduce((sum, item) => sum + item.semantic_diff_count, 0),
  material_diffs: results.reduce((sum, item) => sum + (item.classification_counts.MATERIAL ?? 0), 0),
  delivery_configuration_diffs: results.reduce((sum, item) => sum + (item.classification_counts.DELIVERY_CONFIGURATION ?? 0), 0),
  serialization_only_diffs: results.reduce((sum, item) => sum + (item.classification_counts.SERIALIZATION_ONLY ?? 0), 0),
};

console.log(`META_CREATIVE_DIFF_SUMMARY=${JSON.stringify(totals)}`);
console.log('META_CREATIVE_DIFF=PASS read_only=true');
