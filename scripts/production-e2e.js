#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const args = process.argv.slice(2);
const opts = args.reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  if (key.startsWith('--')) acc[key.replace(/^--/, '')] = value ?? '';
  return acc;
}, {});

const url = (opts.url || process.env.PRODUCTION_E2E_URL || process.env.VITE_API_URL || process.env.URL || '').toString().trim();
const token = (opts.token || process.env.PRODUCTION_E2E_TOKEN || process.env.E2E_TOKEN || process.env.TOKEN || '').toString().trim();

if (!url || !token) {
  console.error('Usage: node scripts/production-e2e.js --url=https://your-app.vercel.app --token=<jwt> [--prompt="Test prompt"]');
  console.error('Or set environment variables: PRODUCTION_E2E_URL and PRODUCTION_E2E_TOKEN, or VITE_API_URL and E2E_TOKEN.');
  process.exit(1);
}

const baseUrl = url.replace(/\/$/, '');
const prompt = opts.prompt || `Production E2E check ${new Date().toISOString()}`;

async function request(path, method = 'GET', body = null, auth = false) {
  const url = `${baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch (err) {
    throw new Error(`Invalid JSON response from ${url}: ${text}`);
  }
  if (!res.ok) {
    throw new Error(`Request failed ${res.status} ${res.statusText} ${url}: ${text}`);
  }
  return data;
}

(async () => {
  console.log('Production E2E validation starting...');

  console.log('\n1) Health check');
  const health = await request('/api/health');
  console.log(JSON.stringify(health, null, 2));
  if (!health.success) throw new Error('Health check failed');

  console.log('\n2) Secrets validation');
  const secrets = await request('/api/health/secrets');
  console.log(JSON.stringify(secrets, null, 2));
  if (!secrets.success) throw new Error('Health secrets check failed');
  if (!secrets.encryptionKey?.valid) {
    throw new Error('ENCRYPTION_KEY is not valid or not configured in production secrets');
  }

  console.log('\n3) Pre-AI audit snapshot');
  const beforeAudit = await request('/api/production/audit', 'GET', null, true);
  console.log(JSON.stringify(beforeAudit, null, 2));
  const beforeAgentOutputs = beforeAudit.audit?.counts?.agent_outputs ?? null;
  const beforeMetaCache = beforeAudit.audit?.counts?.meta_cache ?? null;
  if (beforeMetaCache === 0) {
    console.warn('Warning: meta_cache count is 0 before AI generation.');
  }

  console.log('\n4) AI generation');
  const aiPayload = { prompt };
  const aiResult = await request('/api/ai/generate', 'POST', aiPayload, true);
  console.log(JSON.stringify(aiResult, null, 2));
  if (!aiResult.success || !aiResult.outputId) {
    throw new Error('AI generation did not return a valid outputId');
  }

  console.log('\n5) Post-AI audit snapshot');
  const afterAudit = await request('/api/production/audit', 'GET', null, true);
  console.log(JSON.stringify(afterAudit, null, 2));
  const afterAgentOutputs = afterAudit.audit?.counts?.agent_outputs ?? null;
  if (beforeAgentOutputs !== null && afterAgentOutputs !== null && afterAgentOutputs <= beforeAgentOutputs) {
    console.warn('Agent outputs count did not increase after AI generation. Confirm output persistence.');
  }

  if ((afterAudit.audit?.counts?.meta_cache ?? 0) === 0) {
    console.warn('Meta cache count is zero after E2E validation. Verify Meta Graph API connectivity and cache ingestion.');
  }

  console.log('\nProduction E2E validation completed successfully.');
  process.exit(0);
})().catch((err) => {
  console.error('Production E2E validation failed:', err.message || err);
  process.exit(1);
});
