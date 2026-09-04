#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const activeRoots = [
  'frontend/src',
  'scripts',
  'supabase/functions',
  'supabase/tests',
  '.github/workflows',
];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sql', '.yml', '.yaml', '.json']);
const forbiddenName = /(?:_final|_old|_backup|_copy|\.bak$|\.tmp$|\.old$|~$)/i;
// Assemble review-only sentinels from fragments so this detector never contains
// the complete forbidden string it is searching for.
const forbiddenContentMarkers = [
  ['touch:', 'force inclusion in PR diff'].join(' '),
  ['temporary', 'review-only marker'].join(' '),
];
const forbiddenExactPaths = new Set([
  '.secret-webhook.example',
  '.github/workflows/manual-maintenance.yml',
  '.github/workflows/google-ads-auth-preflight.yml',
  '.github/workflows/google-ads-credential-provision.yml',
  '.github/workflows/google-ads-service-account-sync.yml',
  'scripts/google-ads-auth-preflight.js',
  'scripts/google-ads-auth-preflight.test.js',
  'scripts/sync-google-ads-service-account.js',
  'scripts/sync-google-ads-service-account.test.js',
  'scripts/validate-retired-edge-inventory.mjs',
]);
const requiredProductionPaths = new Set([
  '.github/workflows/deploy-standalone-edge-functions.yml',
  '.github/workflows/google-ads-runtime-acceptance.yml',
  '.github/workflows/update-wordpress-social-proof.yml',
  'scripts/preflight-google-ads-runtime.js',
  'scripts/provision-google-ads-developer-token.js',
  'scripts/converge-google-ads-edge-auth.js',
]);

const failures = [];
const files = [];

async function walk(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!existsSync(absoluteDir)) return;
  for (const entry of await readdir(absoluteDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const relativePath = path.join(relativeDir, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) await walk(relativePath);
    else if (entry.isFile()) files.push(relativePath);
  }
}

for (const activeRoot of activeRoots) await walk(activeRoot);

for (const file of files) {
  const extension = path.extname(file).toLowerCase();
  const base = path.basename(file);
  if (forbiddenName.test(base)) failures.push(`versioned/temporary filename in active code: ${file}`);

  const fileStat = await stat(path.join(root, file));
  if (sourceExtensions.has(extension) && fileStat.size === 0) {
    failures.push(`empty active source/config file: ${file}`);
    continue;
  }

  if (!sourceExtensions.has(extension)) continue;
  const content = await readFile(path.join(root, file), 'utf8');
  for (const marker of forbiddenContentMarkers) {
    if (content.includes(marker)) failures.push(`temporary review marker in ${file}: ${marker}`);
  }

  if (file.startsWith('supabase/functions/') && /https:\/\/[^\s'"`]+\.vercel\.app/i.test(content)) {
    failures.push(`hardcoded Vercel runtime origin in ${file}; configure FRONTEND_URL/PRODUCTION_FALLBACK_URL/CORS_ALLOWED_ORIGINS instead`);
  }
  if (file.startsWith('supabase/functions/') && /\.vercel\\?\.app\$/.test(content)) {
    failures.push(`wildcard Vercel CORS bypass in ${file}`);
  }
}

for (const forbiddenPath of forbiddenExactPaths) {
  if (existsSync(path.join(root, forbiddenPath))) failures.push(`redundant repository artifact present: ${forbiddenPath}`);
}
for (const requiredPath of requiredProductionPaths) {
  if (!files.includes(requiredPath)) failures.push(`required Production owner missing: ${requiredPath}`);
}

const functionsRoot = path.join(root, 'supabase/functions');
if (existsSync(functionsRoot)) {
  for (const entry of await readdir(functionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '_shared') continue;
    const indexPath = `supabase/functions/${entry.name}/index.ts`;
    if (!files.includes(indexPath)) failures.push(`orphan Edge Function directory without index.ts: supabase/functions/${entry.name}`);
  }
}

// Duplicate active source is fail-closed only for byte-identical, non-trivial
// runtime/config files. Historical migrations are intentionally outside this
// detector because applied versions remain audit records until formal cutover.
const duplicateCandidates = files.filter((file) => {
  const extension = path.extname(file).toLowerCase();
  return sourceExtensions.has(extension) && !file.startsWith('scripts/') && !file.includes('/tests/');
});
const hashes = new Map();
for (const file of duplicateCandidates) {
  const content = await readFile(path.join(root, file));
  if (content.length < 200) continue;
  const hash = createHash('sha256').update(content).digest('hex');
  const group = hashes.get(hash) ?? [];
  group.push(file);
  hashes.set(hash, group);
}
for (const group of hashes.values()) {
  if (group.length > 1) failures.push(`byte-identical active source duplicates: ${group.join(', ')}`);
}

if (failures.length > 0) {
  console.error('REPOSITORY_HYGIENE=FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`REPOSITORY_HYGIENE=PASS active_files=${files.length}`);