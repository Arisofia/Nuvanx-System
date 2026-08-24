import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adsetApplyParams,
  adsetDrift,
  buildAdsetContract,
  buildDesiredCreative,
  buildDesiredTargeting,
  classifyAdsetDrift,
  creativeMatches,
  normalizeOwnedTargeting,
  selectedAdsetDrift,
  targetingMatches,
} from '../../scripts/lib/meta-rsv26.js';

const defaults = {
  daily_budget_minor: 500,
  attribution_spec: [
    { event_type: 'CLICK_THROUGH', window_days: 7 },
    { event_type: 'VIEW_THROUGH', window_days: 1 },
  ],
  optimization_goal: 'LEAD_GENERATION',
  billing_event: 'IMPRESSIONS',
  bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  targeting: {
    age_min: 25,
    age_max: 50,
    genders: [2],
    interest_id: 'interest-canonical',
    interest_name: 'Skin care',
    location_key: 'place-canonical',
    radius_km: 10,
  },
  page_id: 'page-canonical',
  instagram_user_id: 'ig-canonical',
  lead_gen_form_id: 'form-canonical',
  cta_type: 'APPLY_NOW',
};

const item = {
  key: 'texture',
  adset_name: 'TOFU | Textura | Madrid',
  ad_name: 'RSV26 | Textura | V1',
  body: 'Canonical body',
  headline: 'Canonical headline',
  description: 'Canonical description',
};

describe('RSV26 targeting contract', () => {
  it('replaces every owned interest/location while preserving placement controls', () => {
    const live = {
      age_min: 18,
      age_max: 65,
      genders: [1, 2],
      publisher_platforms: ['facebook', 'instagram'],
      flexible_spec: [
        { interests: [{ id: 'old-interest' }, { id: 'extra-interest' }] },
        { interests: [{ id: 'another-interest' }] },
      ],
      geo_locations: {
        location_types: ['home', 'recent'],
        places: [{ key: 'old-place', radius: 25, distance_unit: 'kilometer' }],
        cities: [{ key: 'extra-city' }],
      },
    };

    const desired = buildDesiredTargeting(live, defaults.targeting);
    expect(desired.publisher_platforms).toEqual(['facebook', 'instagram']);
    expect(desired.geo_locations.location_types).toEqual(['home', 'recent']);
    expect(desired.flexible_spec).toEqual([{ interests: [{ id: 'interest-canonical', name: 'Skin care' }] }]);
    expect(desired.geo_locations.places).toEqual([{ key: 'place-canonical', radius: 10, distance_unit: 'kilometer' }]);
    expect(desired.geo_locations.cities).toBeUndefined();
    expect(normalizeOwnedTargeting(desired).interests).toEqual(['interest-canonical']);
    expect(targetingMatches(live, desired)).toBe(false);
    expect(targetingMatches(desired, desired)).toBe(true);
  });
});

describe('RSV26 creative contract', () => {
  const source = {
    asset_feed_spec: {
      bodies: [{ text: 'old body 1' }, { text: 'old body 2' }],
      titles: [{ text: 'old title 1' }, { text: 'old title 2' }],
      descriptions: [{ text: 'old description 1' }, { text: 'old description 2' }],
      call_to_action_types: ['LEARN_MORE'],
      call_to_actions: [
        { type: 'LEARN_MORE', value: { lead_gen_form_id: 'old-form', destination: 'LEAD_GENERATION' } },
        { type: 'LEARN_MORE', value: { lead_gen_form_id: 'old-form' } },
      ],
      images: [{ hash: 'canonical-image', adlabels: [{ name: 'feed' }] }],
      link_urls: [{ website_url: 'https://nuvanx.com/' }],
      asset_customization_rules: [{ customization_spec: { publisher_platforms: ['instagram'] }, image_label: { name: 'feed' } }],
    },
    object_story_spec: {
      page_id: 'old-page',
      instagram_user_id: 'old-ig',
      link_data: {
        link: 'https://nuvanx.com/',
        call_to_action: { type: 'LEARN_MORE', value: { lead_gen_form_id: 'old-form' } },
      },
    },
    degrees_of_freedom_spec: { creative_features_spec: { image_touchups: { enroll_status: 'OPT_OUT' } } },
    url_tags: 'utm_source=meta',
  };

  it('uses source media/rules while canonicalizing every text and CTA variant', () => {
    const desired = buildDesiredCreative(source, item, defaults);
    expect(desired.asset_feed_spec.bodies.map((entry) => entry.text)).toEqual(['Canonical body', 'Canonical body']);
    expect(desired.asset_feed_spec.titles.map((entry) => entry.text)).toEqual(['Canonical headline', 'Canonical headline']);
    expect(desired.asset_feed_spec.descriptions.map((entry) => entry.text)).toEqual(['Canonical description', 'Canonical description']);
    expect(desired.asset_feed_spec.call_to_action_types).toEqual(['APPLY_NOW']);
    expect(desired.asset_feed_spec.call_to_actions.every((entry) => entry.type === 'APPLY_NOW')).toBe(true);
    expect(desired.asset_feed_spec.call_to_actions.every((entry) => entry.value.lead_gen_form_id === 'form-canonical')).toBe(true);
    expect(desired.asset_feed_spec.images).toEqual(source.asset_feed_spec.images);
    expect(desired.asset_feed_spec.asset_customization_rules).toEqual(source.asset_feed_spec.asset_customization_rules);
    expect(desired.object_story_spec.page_id).toBe('page-canonical');
    expect(desired.object_story_spec.instagram_user_id).toBe('ig-canonical');
    expect(desired.object_story_spec.link_data.call_to_action).toEqual({
      type: 'APPLY_NOW',
      value: { lead_gen_form_id: 'form-canonical' },
    });
    expect(desired.degrees_of_freedom_spec).toEqual(source.degrees_of_freedom_spec);
    expect(desired.url_tags).toBe('utm_source=meta');
  });

  it('detects non-first text, CTA and media drift', () => {
    const desired = buildDesiredCreative(source, item, defaults);
    expect(creativeMatches(desired, desired)).toBe(true);

    const textDrift = structuredClone(desired);
    textDrift.asset_feed_spec.bodies[1].text = 'drift';
    expect(creativeMatches(textDrift, desired)).toBe(false);

    const ctaDrift = structuredClone(desired);
    ctaDrift.asset_feed_spec.call_to_actions[1].type = 'LEARN_MORE';
    expect(creativeMatches(ctaDrift, desired)).toBe(false);

    const mediaDrift = structuredClone(desired);
    mediaDrift.asset_feed_spec.images[0].hash = 'wrong-image';
    expect(creativeMatches(mediaDrift, desired)).toBe(false);
  });
});

describe('RSV26 ad-set convergence', () => {
  it('detects and writes every canonical ad-set field', () => {
    const adset = {
      name: 'wrong',
      daily_budget: '2000',
      attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }],
      optimization_goal: 'LINK_CLICKS',
      billing_event: 'LINK_CLICKS',
      bid_strategy: 'LOWEST_COST_WITH_BID_CAP',
      targeting: {
        age_min: 18,
        age_max: 65,
        genders: [1],
        flexible_spec: [{ interests: [{ id: 'wrong-interest' }] }],
        geo_locations: { places: [{ key: 'wrong-place', radius: 20 }] },
      },
    };
    const contract = buildAdsetContract(adset, item, defaults);
    expect(adsetDrift(contract).sort()).toEqual([
      'attribution_spec',
      'bid_strategy',
      'billing_event',
      'daily_budget',
      'name',
      'optimization_goal',
      'targeting',
    ].sort());
    const params = adsetApplyParams(contract);
    expect(params).toMatchObject({
      name: item.adset_name,
      daily_budget: '500',
      optimization_goal: 'LEAD_GENERATION',
      billing_event: 'IMPRESSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    });
    expect(params.attribution_spec).toHaveLength(2);
    expect(normalizeOwnedTargeting(params.targeting).interests).toEqual(['interest-canonical']);
  });

  it('partitions drift into explicit mutation families', () => {
    const drift = [
      'name',
      'attribution_spec',
      'daily_budget',
      'optimization_goal',
      'billing_event',
      'bid_strategy',
      'targeting',
    ];
    expect(classifyAdsetDrift(drift)).toEqual({
      names: ['name'],
      attribution: ['attribution_spec'],
      settings: ['daily_budget', 'optimization_goal', 'billing_event', 'bid_strategy', 'targeting'],
    });
    expect(selectedAdsetDrift(drift, { names: true, attribution: false, settings: false })).toEqual(['name']);
    expect(selectedAdsetDrift(drift, { names: false, attribution: true, settings: false })).toEqual(['attribution_spec']);
    expect(selectedAdsetDrift(drift, { names: false, attribution: false, settings: true })).toEqual([
      'daily_budget',
      'optimization_goal',
      'billing_event',
      'bid_strategy',
      'targeting',
    ]);
    expect(selectedAdsetDrift(drift, { names: true, attribution: true, settings: false })).toEqual(['name', 'attribution_spec']);
  });
});

describe('RSV26 apply CLI safety gates', () => {
  const script = fileURLToPath(new URL('../../scripts/meta-apply-rsv26.js', import.meta.url));
  const baseEnv = { ...process.env, META_REPORTING_TOKEN_60D: 'read-only-dummy' };

  function run(args, env = baseEnv) {
    return spawnSync(process.execPath, [script, ...args], {
      env,
      encoding: 'utf8',
      timeout: 5000,
    });
  }

  it('rejects --apply without an explicit mutation family before network access', () => {
    const result = run(['--apply']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--apply requires at least one explicit mutation family');
  });

  it('rejects a mutation-family flag without --apply before network access', () => {
    const result = run(['--apply-names']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Mutation-family flags are only valid together with --apply');
  });

  it('rejects creative apply when no management credential is present before network access', () => {
    const result = run(['--apply', '--apply-creatives']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Apply mode requires META_ADS_MANAGEMENT_TOKEN or META_CANONICAL_ACCESS_TOKEN');
  });
});
