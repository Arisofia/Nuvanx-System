#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = process.cwd();
const TOKENS_FILE = path.join(ROOT, '.env.tokens.local');

const requiredSecretKeys = [
  'META_ACCESS_TOKEN',
  'META_AD_ACCOUNT_ID',
  'META_CAPI_VERSION',
  'ACTION_SOURCE',
  'DEFAULT_PHONE_COUNTRY_CODE',
  'DATABASE_URL',
  'CLINIC_ID',
  'REPORT_USER_ID',
  'GOOGLE_ADS_SERVICE_ACCOUNT',
  'DOCTORALIA_SHEET_ID',
  'SUPABASE_DB_PASSWORD',
  'ENCRYPTION_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
];

const frontendKeys = [
  'VITE_API_BASE_URL',
  'VITE_API_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_FIGMA_URL',
  'VITE_SUPABASE_FIGMA_ANON_KEY',
  'VITE_SENTRY_DSN',
];

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
    const raw = trimmed.slice(idx + 1);
    let value = raw.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function mergeSources() {
  const fileVars = readEnvFile(TOKENS_FILE);
  const merged = { ...fileVars };
  for (const [k, v] of Object.entries(process.env)) {
    if (v && !merged[k]) merged[k] = v;
  }
  return merged;
}

function hasGhCli() {
  try {
    cp.execSync('gh --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, env = process.env) {
  cp.execSync(cmd, { stdio: 'pipe', env });
}

function writeFrontendEnv(vars) {
  const target = path.join(ROOT, 'frontend', '.env.local');
  const existing = readEnvFile(target);
  const lines = frontendKeys.map((key) => `${key}=${vars[key] || existing[key] || ''}`);
  fs.writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
  return target;
}

async function setSupabaseSecrets(vars, projectRef) {
  const accessToken = vars.SUPABASE_ACCESS_TOKEN;
  if (!accessToken || !projectRef) return { skipped: true, reason: 'missing token or project ref' };

  const payload = requiredSecretKeys
    .filter((k) => vars[k])
    .map((k) => ({ name: k, value: vars[k] }));

  if (payload.length === 0) return { skipped: true, reason: 'no secret values to upload' };

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/secrets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase (${projectRef}) ${res.status}: ${body}`);
  }

  return { uploaded: payload.length };
}

async function setVercelSecrets(vars) {
  const token = vars.VERCEL_TOKEN;
  const teamId = vars.VERCEL_TEAM_ID || 'team_R0GOR4jvw1c1gnyBRWYu32O7';
  const projectId = vars.VERCEL_PROJECT_ID || 'prj_IAOBlV17HeS22KuEfsdkDrGMV9Ze';

  if (!token || !projectId) return { skipped: true, reason: 'missing token or project id' };

  let uploaded = 0;

  for (const key of [...requiredSecretKeys, ...frontendKeys]) {
    const value = vars[key];
    if (!value) continue;

    const url = `https://api.vercel.com/v10/projects/${projectId}/env${teamId ? `?teamId=${teamId}` : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key,
        value,
        type: 'encrypted',
        target: ['production', 'preview', 'development'],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 409) {
        // Already exists; skip to avoid destructive updates in this script.
        continue;
      }
      throw new Error(`Vercel ${res.status} for ${key}: ${body}`);
    }

    uploaded += 1;
  }

  return { uploaded };
}

function setGithubSecrets(vars) {
  const owner = vars.GITHUB_OWNER || 'Arisofia';
  const repo = vars.GITHUB_REPO || 'Nuvanx-System';
  const token = vars.GH_TOKEN || vars.GITHUB_TOKEN;

  if (!token) return { skipped: true, reason: 'missing github token' };
  if (!hasGhCli()) return { skipped: true, reason: 'gh CLI not installed' };

  let uploaded = 0;
  for (const key of requiredSecretKeys) {
    const value = vars[key];
    if (!value) continue;
    const env = { ...process.env, GH_TOKEN: token };
    // Use execFileSync directly (no shell) to avoid any shell-injection risk.
    // gh secret set reads the value from --body without shell interpolation.
    cp.execFileSync('gh', ['secret', 'set', key, '--repo', `${owner}/${repo}`, '--body', value], {
      stdio: 'pipe',
      env,
    });
    uploaded += 1;
  }

  return { uploaded };
}

async function main() {
  const vars = mergeSources();

  const frontendEnvPath = writeFrontendEnv(vars);

  const githubResult = setGithubSecrets(vars);
  const supabaseMainResult = await setSupabaseSecrets(vars, vars.SUPABASE_PROJECT_REF || 'ssvvuuysgxyqvmovrlvk');
  const supabaseFigmaResult = await setSupabaseSecrets(vars, vars.SUPABASE_FIGMA_PROJECT_REF || 'zpowfbeftxexzidlxndy');
  const vercelResult = await setVercelSecrets(vars);

  console.log('Secret sync completed.');
  console.log(`Local frontend env: ${frontendEnvPath}`);
  console.log(`GitHub: ${JSON.stringify(githubResult)}`);
  console.log(`Supabase main: ${JSON.stringify(supabaseMainResult)}`);
  console.log(`Supabase figma: ${JSON.stringify(supabaseFigmaResult)}`);
  console.log(`Vercel: ${JSON.stringify(vercelResult)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
