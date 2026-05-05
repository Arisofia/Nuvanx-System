#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');

const META_GRAPH = 'https://graph.facebook.com/v21.0';
const { META_ACCESS_TOKEN, META_APP_SECRET } = process.env;
const adAccountId = 'act_4172099716404860';

const today = new Date();
const until = today.toISOString().slice(0, 10);
const sinceDate = new Date();
sinceDate.setDate(today.getDate() - 30);
const since = sinceDate.toISOString().slice(0, 10);

async function metaFetch(path, params) {
  const url = new URL(`${META_GRAPH}${path}`);
  url.searchParams.set('access_token', META_ACCESS_TOKEN);
  if (META_APP_SECRET) {
    const proof = crypto.createHmac('sha256', META_APP_SECRET).update(META_ACCESS_TOKEN).digest('hex');
    url.searchParams.set('appsecret_proof', proof);
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data.error));
  return data;
}

async function main() {
  console.log(`Fetching insights for ${adAccountId} from ${since} to ${until}...`);
  try {
    const data = await metaFetch(`/${adAccountId}/insights`, {
      fields: 'spend,conversions,actions,action_values,cost_per_action_type',
      time_range: JSON.stringify({ since, until }),
      level: 'account'
    });
    console.log('--- RAW META RESPONSE ---');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.data && data.data.length > 0) {
      const row = data.data[0];
      console.log('\n--- SUMMARY ---');
      console.log('Spend:', row.spend);
      console.log('Conversions Field:', row.conversions);
      console.log('Actions Array:', row.actions ? row.actions.length : 0);
      if (row.actions) {
        row.actions.forEach(a => {
          console.log(`  - ${a.action_type}: ${a.value}`);
        });
      }
    } else {
      console.log('No data returned for this period.');
    }
  } catch (err) {
    console.error('API Error:', err.message);
  }
}

main();
