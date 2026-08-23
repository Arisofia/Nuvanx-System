#!/usr/bin/env node
'use strict';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ACCOUNT_ID = String(process.env.TARGET_AD_ACCOUNT_ID || '').trim();
const CAMPAIGN_ID = String(process.env.TARGET_CAMPAIGN_ID || '').trim();
const ADSET_ID = String(process.env.TARGET_ADSET_ID || '').trim();
const AD_ID = String(process.env.TARGET_AD_ID || '').trim();
let apiUserId = '';

function assertConfig() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase service configuration missing');
  if (!/^act_\d+$/.test(ACCOUNT_ID)) throw new Error('Invalid ad account ID');
  if (![CAMPAIGN_ID, ADSET_ID, AD_ID].every((value) => /^\d+$/.test(value))) throw new Error('Invalid Meta object ID');
}

function headers(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    Accept: 'application/json',
    ...(apiUserId ? { 'x-user-id': apiUserId } : {}),
    ...extra,
  };
}

async function requestApi(path, query = {}) {
  const url = new URL(`${SUPABASE_URL}/functions/v1/api/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(25000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 1000) }; }
  return { status: response.status, ok: response.ok, body };
}

async function supabaseGet(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
  if (!response.ok) throw new Error(`Supabase REST ${response.status}`);
  return await response.json();
}

async function persist(userId, result) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/agent_outputs`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({
      user_id: userId,
      agent_type: 'meta-api-inspect',
      input_context: {
        account_id: ACCOUNT_ID,
        campaign_id: CAMPAIGN_ID,
        adset_id: ADSET_ID,
        ad_id: AD_ID,
      },
      output_text: JSON.stringify(result),
      model_used: 'github-actions-meta-api-probe-v1',
      status: 'completed',
      output: result,
      metadata: { source: 'github_actions', read_only: true, transport: 'supabase_edge_api' },
    }),
  });
  if (!response.ok) throw new Error(`Audit persistence failed ${response.status}`);
}

async function main() {
  assertConfig();
  const integrations = await supabaseGet(
    'integrations?service=eq.meta&status=eq.connected&select=user_id,metadata&order=updated_at.desc&limit=1',
  );
  const integration = integrations?.[0];
  if (!integration?.user_id) throw new Error('Connected Meta integration not found');
  const accounts = [
    ...(Array.isArray(integration.metadata?.adAccountIds) ? integration.metadata.adAccountIds : []),
    ...(Array.isArray(integration.metadata?.ad_account_ids) ? integration.metadata.ad_account_ids : []),
  ];
  if (!accounts.includes(ACCOUNT_ID)) throw new Error('Target account is not allowlisted');
  apiUserId = String(integration.user_id);

  const result = {
    health_meta: await requestApi('health/meta', { adAccountId: ACCOUNT_ID }),
    campaigns: await requestApi('meta/campaigns', { adAccountId: ACCOUNT_ID, campaignId: CAMPAIGN_ID }),
    ads: await requestApi('meta/ads', { adAccountId: ACCOUNT_ID, campaignId: CAMPAIGN_ID, adsetId: ADSET_ID, adId: AD_ID }),
  };

  await persist(integration.user_id, result);
  console.log('META_API_INSPECT=PASS');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('META_API_INSPECT=FAIL');
  console.error(String(error?.message || error));
  process.exit(1);
});
