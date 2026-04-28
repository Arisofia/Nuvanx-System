#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
const ROOT = process.cwd();
const TOKENS_FILE = path.join(ROOT, '.env.tokens.local');

function parseArgs(argv) {
  const args = {
    write: false,
    adAccountId: '',
    appId: '',
    appSecret: '',
    shortLivedToken: '',
    auditFile: '',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--write') {
      args.write = true;
      continue;
    }
    if (token === '--ad-account-id') {
      args.adAccountId = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--app-id') {
      args.appId = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--app-secret') {
      args.appSecret = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--short-token') {
      args.shortLivedToken = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--audit-file') {
      args.auditFile = argv[i + 1] || '';
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function normalizeAdAccountId(raw) {
  const cleaned = String(raw || '').trim();
  if (!cleaned) return '';
  const digits = cleaned.replace(/^act_/i, '').replaceAll(/\D/g, '');
  return digits ? `act_${digits}` : '';
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function writeEnvFile(filePath, patch) {
  const existing = readEnvFile(filePath);
  const merged = { ...existing, ...patch };
  const keys = Object.keys(merged).sort((a, b) => a.localeCompare(b));
  const lines = keys.map((key) => `${key}=${merged[key] || ''}`);
  const content = lines.join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function graphGet(endpoint, params) {
  const url = new URL(`${GRAPH_API_BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20000) });
  const data = await res.json();
  if (!res.ok) {
    const message = data?.error?.message || `Graph API ${res.status}`;
    throw new Error(message);
  }
  return data;
}

async function exchangeForLongLivedToken({ appId, appSecret, shortLivedToken }) {
  return graphGet('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });
}

async function inspectToken({ appId, appSecret, accessToken }) {
  const appToken = `${appId}|${appSecret}`;
  return graphGet('/debug_token', {
    input_token: accessToken,
    access_token: appToken,
  });
}

async function listAccessibleAdAccounts(accessToken) {
  const data = await graphGet('/me/adaccounts', {
    fields: 'id,account_id,name,account_status,currency',
    limit: '200',
    access_token: accessToken,
  });
  return Array.isArray(data?.data) ? data.data : [];
}

function printUsage() {
  console.log([
    'Generate a long-lived Meta token via CLI and optionally persist to .env.tokens.local.',
    '',
    'Usage:',
    '  node scripts/generate-meta-token.js --app-id <APP_ID> --app-secret <APP_SECRET> --short-token <SHORT_LIVED_TOKEN> [--ad-account-id act_123] [--write]',
    '',
    'Options:',
    '  --app-id          Meta App ID (or set META_APP_ID env var)',
    '  --app-secret      Meta App Secret (or set META_APP_SECRET env var)',
    '  --short-token     Short-lived user token to exchange (or META_SHORT_LIVED_TOKEN env var)',
    '  --ad-account-id   Optional account to validate against (act_123 or 123)',
    '  --write           Persist META_ACCESS_TOKEN (+ META_AD_ACCOUNT_ID if provided) into .env.tokens.local',
    '  --audit-file      Write a non-secret JSON execution report proving live API execution',
  ].join('\n'));
}

function resolveInputs(args, envVars) {
  const appId = args.appId || process.env.META_APP_ID || envVars.META_APP_ID || '';
  const appSecret = args.appSecret || process.env.META_APP_SECRET || envVars.META_APP_SECRET || '';
  const shortLivedToken = args.shortLivedToken || process.env.META_SHORT_LIVED_TOKEN || envVars.META_SHORT_LIVED_TOKEN || '';
  const targetAdAccountId = normalizeAdAccountId(args.adAccountId || process.env.META_AD_ACCOUNT_ID || envVars.META_AD_ACCOUNT_ID || '');

  if (!appId || !appSecret || !shortLivedToken) {
    throw new Error('Missing required inputs. Provide --app-id, --app-secret, --short-token (or META_APP_ID, META_APP_SECRET, META_SHORT_LIVED_TOKEN).');
  }

  return { appId, appSecret, shortLivedToken, targetAdAccountId };
}

function printTokenSummary(tokenData, normalizedAccounts, longLivedToken, targetAdAccountId, args) {
  console.log('');
  console.log('✅ Token generated successfully.');
  console.log(`Token type: ${tokenData.type || 'unknown'}`);
  console.log(`Expires at: ${tokenData.expires_at ? new Date(tokenData.expires_at * 1000).toISOString() : 'not provided (likely long-lived/system)'}`);
  console.log(`Scopes: ${(tokenData.scopes || []).join(', ') || 'not provided'}`);
  console.log(`Accessible ad accounts: ${normalizedAccounts.length}`);
  for (const account of normalizedAccounts.slice(0, 20)) {
    console.log(`  - ${account.id} | ${account.name} | status=${account.status} | currency=${account.currency}`);
  }
  if (normalizedAccounts.length > 20) {
    console.log(`  ... and ${normalizedAccounts.length - 20} more`);
  }

  if (args.write) {
    const patch = { META_ACCESS_TOKEN: longLivedToken };
    if (targetAdAccountId) patch.META_AD_ACCOUNT_ID = targetAdAccountId;
    writeEnvFile(TOKENS_FILE, patch);
    console.log(`\n✅ Saved token to ${TOKENS_FILE}`);
    console.log('Next step: run `npm run secrets:sync:all` to propagate this token to Supabase/Vercel/GitHub.');
  } else {
    console.log('\nLong-lived token (store securely):');
    console.log(longLivedToken);
    console.log('\nTip: rerun with --write to persist into .env.tokens.local.');
  }
}

function writeAuditFile(args, longLivedToken, tokenData, normalizedAccounts, targetAdAccountId) {
  if (!args.auditFile) return;

  const audit = {
    generatedAt: new Date().toISOString(),
    graphApiBase: GRAPH_API_BASE,
    tokenType: tokenData.type || null,
    expiresAt: tokenData.expires_at ? new Date(tokenData.expires_at * 1000).toISOString() : null,
    tokenFingerprintSha256: tokenFingerprint(longLivedToken),
    scopes: tokenData.scopes || [],
    requestedAdAccountId: targetAdAccountId || null,
    accessibleAdAccounts: normalizedAccounts,
    accessibleAdAccountsCount: normalizedAccounts.length,
  };

  const auditPath = path.isAbsolute(args.auditFile) ? args.auditFile : path.join(ROOT, args.auditFile);
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  console.log(`✅ Wrote execution audit to ${auditPath}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printUsage();
    return;
  }

  const envVars = readEnvFile(TOKENS_FILE);
  const { appId, appSecret, shortLivedToken, targetAdAccountId } = resolveInputs(args, envVars);

  console.log('Exchanging short-lived token for long-lived token...');
  const tokenPayload = await exchangeForLongLivedToken({ appId, appSecret, shortLivedToken });
  const longLivedToken = tokenPayload.access_token;
  if (!longLivedToken) throw new Error('Meta did not return access_token from exchange.');

  console.log('Inspecting token health...');
  const inspection = await inspectToken({ appId, appSecret, accessToken: longLivedToken });
  const tokenData = inspection?.data || {};

  console.log('Fetching accessible ad accounts...');
  const accounts = await listAccessibleAdAccounts(longLivedToken);
  const normalizedAccounts = accounts.map((row) => ({
    id: normalizeAdAccountId(row.id || row.account_id),
    name: row.name || '',
    status: row.account_status,
    currency: row.currency || '',
  }));

  if (targetAdAccountId) {
    const hasTarget = normalizedAccounts.some((a) => a.id === targetAdAccountId);
    if (!hasTarget) {
      throw new Error(`Token generated, but it cannot access requested account ${targetAdAccountId}.`);
    }
  }

  printTokenSummary(tokenData, normalizedAccounts, longLivedToken, targetAdAccountId, args);
  writeAuditFile(args, longLivedToken, tokenData, normalizedAccounts, targetAdAccountId);
}

main().catch(() => {
  console.error('❌ Token generation failed.');
  console.error('An unexpected error occurred while generating the token.');
  process.exit(1);
});
