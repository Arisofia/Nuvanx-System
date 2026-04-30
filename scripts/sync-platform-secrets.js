#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = process.cwd();
const TOKENS_FILE = path.join(ROOT, '.env.tokens.local');
const LEGACY_TOKENS_FILE = path.join(ROOT, '.secrets.local');

function normalizeSafePath(filePath, baseDir = ROOT) {
  const resolved = path.resolve(baseDir, filePath);
  const normalizedBase = path.resolve(baseDir);
  if (resolved !== normalizedBase && !resolved.startsWith(`${normalizedBase}${path.sep}`)) {
    throw new Error(`Unsafe path access blocked: ${filePath}`);
  }
  return resolved;
}

const requiredSecretKeys = [
  'SUPABASE_ACCESS_TOKEN',
  'META_ACCESS_TOKEN',
  'META_AD_ACCOUNT_ID',
  'META_CAPI_VERSION',
  'ACTION_SOURCE',
  'DEFAULT_PHONE_COUNTRY_CODE',
  'DATABASE_URL',
  'CLINIC_ID',
  'REPORT_USER_ID',
  'GOOGLE_ADS_SERVICE_ACCOUNT',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'DOCTORALIA_SHEET_ID',
  'DOCTORALIA_DRIVE_FILE_ID',
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
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_FIGMA_URL',
  'VITE_SUPABASE_FIGMA_ANON_KEY',
  'VITE_SENTRY_DSN',
];

function readEnvFile(filePath) {
  const safePath = normalizeSafePath(filePath);
  if (!fs.existsSync(safePath)) return {};
  const out = {};
  const lines = fs.readFileSync(safePath, 'utf8').split(/\r?\n/);
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
  const fileVars = {
    ...readEnvFile(LEGACY_TOKENS_FILE),
    ...readEnvFile(TOKENS_FILE),
  };
  const merged = { ...fileVars };
  for (const [k, v] of Object.entries(process.env)) {
    if (v && !merged[k]) merged[k] = v;
  }

  // Alias Doctoralia drive file ID between older and newer variable names.
  if (merged.DOCTORALIA_DRIVE_FILE_ID && !merged.DOCTORALIA_SHEET_ID) {
    merged.DOCTORALIA_SHEET_ID = merged.DOCTORALIA_DRIVE_FILE_ID;
  }
  if (merged.DOCTORALIA_SHEET_ID && !merged.DOCTORALIA_DRIVE_FILE_ID) {
    merged.DOCTORALIA_DRIVE_FILE_ID = merged.DOCTORALIA_SHEET_ID;
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

async function vercelFetch(url, method, token, body = null) {
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const resBody = await res.text();
    throw new Error(`Vercel ${res.status} ${method} ${url}: ${resBody}`);
  }
  return res;
}

async function deleteVercelEnv(projectId, envId, token, queryString) {
  const url = `https://api.vercel.com/v10/projects/${projectId}/env/${envId}${queryString}`;
  await vercelFetch(url, 'DELETE', token);
}

async function createVercelEnv(projectId, key, value, targets, token, queryString) {
  const url = `https://api.vercel.com/v10/projects/${projectId}/env${queryString}`;
  await vercelFetch(url, 'POST', token, {
    key,
    value,
    type: 'encrypted',
    target: targets,
  });
}

async function updateVercelEnv(projectId, envId, value, token, queryString) {
  const url = `https://api.vercel.com/v10/projects/${projectId}/env/${envId}${queryString}`;
  await vercelFetch(url, 'PATCH', token, { value });
}

async function handleVercelKey(key, value, existingMap, projectId, token, queryString, requiredTargets) {
  if (existingMap.has(key)) {
    const existingEnvs = existingMap.get(key);
    const existingTargets = new Set(existingEnvs.flatMap((env) => Array.isArray(env.target) ? env.target : [env.target]));

    if (existingEnvs.length > 1) {
      for (const env of existingEnvs) {
        await deleteVercelEnv(projectId, env.id, token, queryString);
      }
      await createVercelEnv(projectId, key, value, requiredTargets, token, queryString);
      return 1;
    }

    const env = existingEnvs[0];
    try {
      await updateVercelEnv(projectId, env.id, value, token, queryString);
    } catch (error) {
      console.warn(`Patch failed for ${key}, falling back to delete/create: ${error.message}`);
      for (const e of existingEnvs) {
        await deleteVercelEnv(projectId, e.id, token, queryString);
      }
      await createVercelEnv(projectId, key, value, requiredTargets, token, queryString);
    }

    const missingTargets = requiredTargets.filter((t) => !existingTargets.has(t));
    if (missingTargets.length > 0) {
      await createVercelEnv(projectId, key, value, missingTargets, token, queryString);
    }
    return 1;
  }

  await createVercelEnv(projectId, key, value, requiredTargets, token, queryString);
  return 1;
}

async function setVercelSecrets(vars) {
  const token = vars.VERCEL_TOKEN;
  const teamId = vars.VERCEL_TEAM_ID || 'team_R0GOR4jvw1c1gnyBRWYu32O7';
  const projectId = vars.VERCEL_PROJECT_ID || 'prj_IAOBlV17HeS22KuEfsdkDrGMV9Ze';

  if (!token || !projectId) return { skipped: true, reason: 'missing token or project id' };

  let uploaded = 0;
  const queryString = teamId ? `?teamId=${teamId}` : '';
  const listUrl = `https://api.vercel.com/v10/projects/${projectId}/env${queryString}`;

  const existingResp = await vercelFetch(listUrl, 'GET', token);
  const existingJson = await existingResp.json();
  const existingMap = new Map();
  for (const env of existingJson.envs || []) {
    existingMap.set(env.key, [...(existingMap.get(env.key) || []), env]);
  }

  const requiredTargets = ['production', 'preview', 'development'];
  for (const key of frontendKeys) {
    const value = vars[key];
    if (!value) continue;
    uploaded += await handleVercelKey(key, value, existingMap, projectId, token, queryString, requiredTargets);
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
  const githubKeys = [...requiredSecretKeys, 'SUPABASE_ACCESS_TOKEN', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY'];
  for (const key of githubKeys) {
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
