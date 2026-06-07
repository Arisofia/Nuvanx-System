#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

for (const envFile of ['.env.local', '.env']) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';
const MIN_NODE_MAJOR = 18;

function fail(message) {
  console.error('❌', message);
  process.exit(1);
}

function normalizeAdAccountId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.toLowerCase().startsWith('act_') ? value : `act_${value}`;
}

function parseAccountIds(raw) {
  return String(raw || '')
    .split(/[\s,]+/)
    .map(normalizeAdAccountId)
    .filter(Boolean);
}

function redactAccountId(accountId) {
  const value = String(accountId || '');
  if (!value) return '[redacted]';
  const suffix = value.slice(-4);
  return `***${suffix}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    list: false,
    details: false,
    insightsDays: 0,
    json: false,
    accountIds: [],
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--list':
        opts.list = true;
        break;
      case '--details':
        opts.details = true;
        break;
      case '--insights':
        opts.insightsDays = Number(args[++i] || '0');
        break;
      case '--ad-accounts':
        opts.accountIds = parseAccountIds(args[++i] || '');
        break;
      case '--json':
        opts.json = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        fail(`Unknown option: ${arg}. Use --help to show available flags.`);
    }
  }
  return opts;
}

function printHelp() {
  console.log('Usage: node scripts/meta-ads-account-report.js [options]');
  console.log('Options:');
  console.log('  --list                 List accessible Meta ad accounts');
  console.log('  --details              Include account detail fetch attempts');
  console.log('  --insights <days>      Fetch last N days of account insights');
  console.log('  --ad-accounts <ids>    Override configured META_AD_ACCOUNT_IDS');
  console.log('  --json                 Output results as JSON');
  console.log('  --help, -h             Show this help message');
  process.exit(0);
}

function buildAppSecretProof(accessToken) {
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  if (!appSecret) return '';
  return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

function createMetaUrl(pathname, accessToken, params = {}) {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}${pathname}`);
  url.searchParams.set('access_token', accessToken);
  const appsecretProof = buildAppSecretProof(accessToken);
  if (appsecretProof) {
    url.searchParams.set('appsecret_proof', appsecretProof);
  }
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, value);
  });
  return url;
}

async function fetchJson(url) {
  const res = await fetch(url.toString());
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const errorMessage = body.error?.message || `Meta API request failed with status ${res.status}`;
    const err = new Error(errorMessage);
    err.responseBody = body;
    err.status = res.status;
    throw err;
  }
  return body;
}

async function listAccessibleAdAccounts(accessToken) {
  const url = createMetaUrl('/me/adaccounts', accessToken, {
    fields: 'id,name,account_status,currency,time_zone_id',
    limit: '500',
  });
  const payload = await fetchJson(url);
  return Array.isArray(payload.data) ? payload.data : [];
}

async function fetchAccountDetails(accessToken, accountId) {
  const url = createMetaUrl(`/${accountId}`, accessToken, {
    fields: 'id,name,account_status,currency,amount_spent',
  });
  return await fetchJson(url);
}

function summarizeActions(actions) {
  const rows = Array.isArray(actions) ? actions : [];
  const summary = { conversions: 0, messaging: 0, link_clicks: 0, other: 0 };

  for (const action of rows) {
    const actionType = String(action.action_type || '').toLowerCase();
    const value = Number(action.value || 0);
    if (/lead|conversion|complete_registration/.test(actionType)) {
      summary.conversions += value;
    } else if (/messaging|conversation/.test(actionType)) {
      summary.messaging += value;
    } else if (actionType === 'link_click') {
      summary.link_clicks += value;
    } else {
      summary.other += value;
    }
  }

  return summary;
}

async function fetchAccountInsights(accessToken, accountId, days) {
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const url = createMetaUrl(`/${accountId}/insights`, accessToken, {
    fields: 'date_start,date_stop,spend,impressions,clicks,actions',
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    limit: '1000',
  });
  return await fetchJson(url);
}

function formatAccountRow(row) {
  return {
    id: normalizeAdAccountId(row.id),
    name: String(row.name || '').trim() || '<unnamed>',
    status: row.account_status,
    currency: String(row.currency || '').trim() || 'unknown',
    timezone: String(row.time_zone_id || '').trim() || 'unknown',
  };
}

function printSummaryLine(label, value) {
  console.log(`${label}: ${value}`);
}

async function main() {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isInteger(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
    fail(`Node.js ${MIN_NODE_MAJOR}+ is required.`);
  }

  const opts = parseArgs();
  if (opts.help) return printHelp();
  if (!opts.list && !opts.details && opts.insightsDays === 0 && !opts.json) {
    opts.list = true;
  }

  const accessToken = String(process.env.META_ACCESS_TOKEN || '').trim();
  if (!accessToken) fail('Missing required env var: META_ACCESS_TOKEN.');

  const envAccountIds = parseAccountIds(process.env.META_AD_ACCOUNT_IDS || process.env.META_AD_ACCOUNT_ID || '');
  const targetIds = opts.accountIds.length ? opts.accountIds : envAccountIds;

  let accounts;
  try {
    accounts = await listAccessibleAdAccounts(accessToken);
  } catch (err) {
    fail(`Unable to list accessible ad accounts: ${err.message}`);
  }

  const normalizedAccounts = accounts.map(formatAccountRow);
  const accessibleIds = new Set(normalizedAccounts.map((acct) => acct.id));

  const shouldPrintAccessible = opts.list || opts.details || opts.insightsDays > 0 || opts.json;
  if (shouldPrintAccessible) {
    printSummaryLine('Accessible ad accounts', normalizedAccounts.length);
    if (opts.json) {
      const result = { accessible_accounts: normalizedAccounts };
      if (targetIds.length) {
        result.configured_target_account_ids = targetIds;
      }
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    normalizedAccounts.forEach((acct) => {
      console.log(`${acct.id} | ${acct.name} | status=${acct.status} | currency=${acct.currency} | timezone=${acct.timezone}`);
    });
  }

  if (targetIds.length) {
    console.log('\nConfigured target ad accounts:');
    targetIds.forEach((id) => {
      const present = accessibleIds.has(id) ? 'accessible' : 'missing';
      console.log(`- ${id} (${present})`);
    });

    const missingIds = targetIds.filter((id) => !accessibleIds.has(id));
    if (missingIds.length) {
      fail(`Configured target account(s) are not accessible: ${missingIds.join(', ')}`);
    }

    if (opts.details) {
      console.log('\nFetching account details...');
      for (const accountId of targetIds) {
        try {
          const details = await fetchAccountDetails(accessToken, accountId);
          console.log(`\n${accountId} details:`);
          console.log(`  name: ${details.name || '<unknown>'}`);
          console.log(`  status: ${details.account_status}`);
          console.log(`  currency: ${details.currency || '<unknown>'}`);
          console.log(`  amount_spent: ${details.amount_spent ?? '<unknown>'}`);
        } catch (err) {
          console.error(`  Failed to fetch details for ${accountId}: ${err.message}`);
        }
      }
    }

    if (opts.insightsDays > 0) {
      console.log(`\nFetching account insights for the last ${opts.insightsDays} days...`);
      for (const accountId of targetIds) {
        try {
          const payload = await fetchAccountInsights(accessToken, accountId, opts.insightsDays);
          const rows = Array.isArray(payload.data) ? payload.data : [];
          const totals = rows.reduce(
            (acc, row) => {
              acc.spend += Number(row.spend || 0);
              acc.impressions += Number(row.impressions || 0);
              acc.clicks += Number(row.clicks || 0);
              const actionSummary = summarizeActions(row.actions);
              acc.conversions += actionSummary.conversions;
              acc.messaging += actionSummary.messaging;
              acc.link_clicks += actionSummary.link_clicks;
              return acc;
            },
            { spend: 0, impressions: 0, clicks: 0, conversions: 0, messaging: 0, link_clicks: 0 }
          );

          console.log(`\n${accountId} summary:`);
          console.log(`  rows: ${rows.length}`);
          console.log(`  spend: ${totals.spend}`);
          console.log(`  impressions: ${totals.impressions}`);
          console.log(`  clicks: ${totals.clicks}`);
          console.log(`  conversions: ${totals.conversions}`);
          console.log(`  messaging: ${totals.messaging}`);
          console.log(`  link clicks: ${totals.link_clicks}`);
        } catch (err) {
          console.error(`  Failed to fetch insights for ${redactAccountId(accountId)}: ${err.message}`);
        }
      }
    }
  }
}

main().catch((err) => {
  fail(err.message || 'Unexpected error');
});
