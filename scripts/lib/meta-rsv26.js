const OWNED_GEO_KEYS = ['places', 'cities', 'regions', 'zips', 'countries', 'custom_locations', 'geo_markets', 'electoral_districts'];

export const RSV26_ADSET_MUTATION_FAMILIES = Object.freeze({
  names: Object.freeze(['name']),
  attribution: Object.freeze(['attribution_spec']),
  settings: Object.freeze(['daily_budget', 'optimization_goal', 'billing_event', 'bid_strategy', 'targeting']),
});

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sortedStrings(values) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].sort();
}

function normalizePlaces(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((place) => ({
      key: String(place?.key ?? '').trim(),
      radius: Number(place?.radius ?? 0),
      distance_unit: String(place?.distance_unit ?? 'kilometer').trim() || 'kilometer',
    }))
    .filter((place) => place.key)
    .sort((a, b) => `${a.key}:${a.radius}:${a.distance_unit}`.localeCompare(`${b.key}:${b.radius}:${b.distance_unit}`));
}

function normalizeGeoIds(values) {
  if (!Array.isArray(values)) return [];
  return sortedStrings(values.map((value) => value?.key ?? value?.id ?? value));
}

export function normalizeOwnedTargeting(targeting = {}) {
  const flexibleSpecs = Array.isArray(targeting?.flexible_spec) ? targeting.flexible_spec : [];
  const interests = sortedStrings(
    flexibleSpecs.flatMap((spec) => Array.isArray(spec?.interests) ? spec.interests.map((interest) => interest?.id) : []),
  );
  const geo = targeting?.geo_locations ?? {};
  return {
    age_min: Number(targeting?.age_min ?? 0),
    age_max: Number(targeting?.age_max ?? 0),
    genders: Array.isArray(targeting?.genders) ? targeting.genders.map(Number).sort((a, b) => a - b) : [],
    interests,
    geo_locations: {
      places: normalizePlaces(geo?.places),
      cities: normalizeGeoIds(geo?.cities),
      regions: normalizeGeoIds(geo?.regions),
      zips: normalizeGeoIds(geo?.zips),
      countries: sortedStrings(Array.isArray(geo?.countries) ? geo.countries : []),
      custom_locations: normalizeGeoIds(geo?.custom_locations),
      geo_markets: normalizeGeoIds(geo?.geo_markets),
      electoral_districts: normalizeGeoIds(geo?.electoral_districts),
    },
  };
}

export function buildDesiredTargeting(currentTargeting = {}, canonicalTargeting) {
  const desired = structuredClone(currentTargeting ?? {});
  desired.age_min = Number(canonicalTargeting.age_min);
  desired.age_max = Number(canonicalTargeting.age_max);
  desired.genders = canonicalTargeting.genders.map(Number);
  desired.flexible_spec = [{
    interests: [{
      id: String(canonicalTargeting.interest_id),
      name: String(canonicalTargeting.interest_name ?? ''),
    }],
  }];

  const geo = structuredClone(desired.geo_locations ?? {});
  for (const key of OWNED_GEO_KEYS) delete geo[key];
  geo.places = [{
    key: String(canonicalTargeting.location_key),
    radius: Number(canonicalTargeting.radius_km),
    distance_unit: 'kilometer',
  }];
  desired.geo_locations = geo;
  return desired;
}

export function targetingMatches(actualTargeting, desiredTargeting) {
  return same(normalizeOwnedTargeting(actualTargeting), normalizeOwnedTargeting(desiredTargeting));
}

function replaceAllText(entries, text, label) {
  if (!Array.isArray(entries) || entries.length === 0) {
    if (label === 'descriptions') return [{ text }];
    throw new Error(`source creative has no asset_feed_spec.${label}`);
  }
  return entries.map((entry) => ({ ...structuredClone(entry), text }));
}

function canonicalizeCallToAction(callToAction, defaults) {
  const cloned = structuredClone(callToAction ?? {});
  cloned.type = defaults.cta_type;
  cloned.value = {
    ...(cloned.value ?? {}),
    lead_gen_form_id: String(defaults.lead_gen_form_id),
  };
  return cloned;
}

function canonicalizeStoryCta(storyPart, defaults) {
  if (!storyPart || typeof storyPart !== 'object') return storyPart;
  const cloned = structuredClone(storyPart);
  if (cloned.call_to_action) cloned.call_to_action = canonicalizeCallToAction(cloned.call_to_action, defaults);
  return cloned;
}

export function buildDesiredCreative(sourceCreative, item, defaults) {
  const sourceAsset = structuredClone(sourceCreative?.asset_feed_spec ?? {});
  if (!(sourceAsset.images?.length > 0 || sourceAsset.videos?.length > 0)) {
    throw new Error(`${item.key}: configured source creative has no image or video assets`);
  }
  sourceAsset.bodies = replaceAllText(sourceAsset.bodies, item.body, 'bodies');
  sourceAsset.titles = replaceAllText(sourceAsset.titles, item.headline, 'titles');
  sourceAsset.descriptions = replaceAllText(sourceAsset.descriptions, item.description, 'descriptions');
  sourceAsset.call_to_action_types = [defaults.cta_type];
  const existingCalls = Array.isArray(sourceAsset.call_to_actions) && sourceAsset.call_to_actions.length > 0
    ? sourceAsset.call_to_actions
    : [{}];
  sourceAsset.call_to_actions = existingCalls.map((entry) => canonicalizeCallToAction(entry, defaults));

  const story = structuredClone(sourceCreative?.object_story_spec ?? {});
  story.page_id = String(defaults.page_id);
  story.instagram_user_id = String(defaults.instagram_user_id);
  for (const key of ['link_data', 'video_data', 'photo_data', 'template_data']) {
    if (story[key]) story[key] = canonicalizeStoryCta(story[key], defaults);
  }

  return {
    asset_feed_spec: sourceAsset,
    object_story_spec: story,
    degrees_of_freedom_spec: structuredClone(sourceCreative?.degrees_of_freedom_spec ?? null),
    url_tags: sourceCreative?.url_tags ?? null,
  };
}

function normalizeTextEntries(entries) {
  return Array.isArray(entries) ? entries.map((entry) => trimmed(entry?.text)) : [];
}

function normalizeCallToActions(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => stable({
    type: String(entry?.type ?? ''),
    value: entry?.value ?? {},
  }));
}

export function creativeContract(creative = {}) {
  const asset = creative?.asset_feed_spec ?? {};
  const story = creative?.object_story_spec ?? {};
  return stable({
    bodies: normalizeTextEntries(asset.bodies),
    titles: normalizeTextEntries(asset.titles),
    descriptions: normalizeTextEntries(asset.descriptions),
    call_to_action_types: sortedStrings(Array.isArray(asset.call_to_action_types) ? asset.call_to_action_types : []),
    call_to_actions: normalizeCallToActions(asset.call_to_actions),
    images: asset.images ?? [],
    videos: asset.videos ?? [],
    link_urls: asset.link_urls ?? [],
    ad_formats: asset.ad_formats ?? [],
    asset_customization_rules: asset.asset_customization_rules ?? [],
    optimization_type: asset.optimization_type ?? null,
    page_id: String(story?.page_id ?? ''),
    instagram_user_id: String(story?.instagram_user_id ?? ''),
    link_data: story?.link_data ?? null,
    video_data: story?.video_data ?? null,
    photo_data: story?.photo_data ?? null,
    template_data: story?.template_data ?? null,
    degrees_of_freedom_spec: creative?.degrees_of_freedom_spec ?? null,
    url_tags: creative?.url_tags ?? null,
  });
}

export function creativeMatches(actualCreative, desiredCreative) {
  return same(creativeContract(actualCreative), creativeContract(desiredCreative));
}

function normalizeAttribution(spec) {
  if (!Array.isArray(spec)) return [];
  return spec
    .map((entry) => ({ event_type: String(entry?.event_type ?? ''), window_days: Number(entry?.window_days ?? 0) }))
    .sort((a, b) => `${a.event_type}:${a.window_days}`.localeCompare(`${b.event_type}:${b.window_days}`));
}

export function buildAdsetContract(adset, item, defaults) {
  const desiredTargeting = buildDesiredTargeting(adset?.targeting ?? {}, defaults.targeting);
  return {
    desired: {
      name: item.adset_name,
      daily_budget: Number(defaults.daily_budget_minor),
      attribution_spec: normalizeAttribution(defaults.attribution_spec),
      optimization_goal: defaults.optimization_goal,
      billing_event: defaults.billing_event,
      bid_strategy: defaults.bid_strategy,
      targeting: desiredTargeting,
    },
    actual: {
      name: adset?.name ?? '',
      daily_budget: Number(adset?.daily_budget ?? 0),
      attribution_spec: normalizeAttribution(adset?.attribution_spec),
      optimization_goal: adset?.optimization_goal ?? '',
      billing_event: adset?.billing_event ?? '',
      bid_strategy: adset?.bid_strategy ?? '',
      targeting: adset?.targeting ?? {},
    },
  };
}

export function adsetDrift(contract) {
  const drift = [];
  for (const field of ['name', 'daily_budget', 'attribution_spec', 'optimization_goal', 'billing_event', 'bid_strategy']) {
    if (!same(contract.actual[field], contract.desired[field])) drift.push(field);
  }
  if (!targetingMatches(contract.actual.targeting, contract.desired.targeting)) drift.push('targeting');
  return drift;
}

export function classifyAdsetDrift(fields = []) {
  const fieldSet = new Set(fields);
  return {
    names: RSV26_ADSET_MUTATION_FAMILIES.names.filter((field) => fieldSet.has(field)),
    attribution: RSV26_ADSET_MUTATION_FAMILIES.attribution.filter((field) => fieldSet.has(field)),
    settings: RSV26_ADSET_MUTATION_FAMILIES.settings.filter((field) => fieldSet.has(field)),
  };
}

export function selectedAdsetDrift(fields = [], selection = {}) {
  const classified = classifyAdsetDrift(fields);
  return [
    ...(selection.names ? classified.names : []),
    ...(selection.attribution ? classified.attribution : []),
    ...(selection.settings ? classified.settings : []),
  ];
}

export function adsetApplyParams(contract) {
  return {
    name: contract.desired.name,
    daily_budget: String(contract.desired.daily_budget),
    attribution_spec: contract.desired.attribution_spec,
    optimization_goal: contract.desired.optimization_goal,
    billing_event: contract.desired.billing_event,
    bid_strategy: contract.desired.bid_strategy,
    targeting: contract.desired.targeting,
  };
}

export function adsetRollbackParams(contract) {
  return {
    name: contract.actual.name,
    daily_budget: String(contract.actual.daily_budget),
    attribution_spec: contract.actual.attribution_spec,
    optimization_goal: contract.actual.optimization_goal,
    billing_event: contract.actual.billing_event,
    bid_strategy: contract.actual.bid_strategy,
    targeting: contract.actual.targeting,
  };
}
