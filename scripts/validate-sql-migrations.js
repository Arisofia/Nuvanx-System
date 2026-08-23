#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase/migrations');
const failures = [];
const SECURITY_CUTOVER_VERSION = '20260823020855';
const SECURITY_CUTOVER_FILE = `${SECURITY_CUTOVER_VERSION}_close_anon_dashboard_and_doctoralia_definer_surface.sql`;
const ANON_PROTECTED_TABLES = [
  'deck_progress',
  'doctoralia_appointments_ingestion',
  'meta_attribution',
  'meta_cache',
  'meta_daily_insights',
  'meta_ig_account_daily',
  'meta_ig_media_performance',
  'meta_organic_daily',
  'meta_post_performance',
];

function walkSqlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkSqlFiles(fullPath);
      return entry.isFile() && entry.name.endsWith('.sql') ? [fullPath] : [];
    })
    .sort();
}

function migrationVersion(file) {
  const match = path.basename(file).match(/^(\d+)_/);
  return match?.[1] ?? '';
}

function assertSecurityCutover(files) {
  const cutoverPath = files.find((file) => path.basename(file) === SECURITY_CUTOVER_FILE);
  if (!cutoverPath) {
    failures.push(`supabase/migrations/${SECURITY_CUTOVER_FILE}: required P0 security cutover migration is missing.`);
    return;
  }

  const cutover = fs.readFileSync(cutoverPath, 'utf8');
  const requiredFragments = [
    'REVOKE EXECUTE ON FUNCTION public.refresh_doctoralia_funnel(uuid)',
    'FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.refresh_doctoralia_funnel(uuid)',
    'TO service_role',
    ...ANON_PROTECTED_TABLES.map((table) => `REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM anon`),
  ];
  for (const fragment of requiredFragments) {
    if (!cutover.includes(fragment)) {
      failures.push(`supabase/migrations/${SECURITY_CUTOVER_FILE}: missing required security fragment: ${fragment}`);
    }
  }

  for (const file of files) {
    const version = migrationVersion(file);
    if (!version || version <= SECURITY_CUTOVER_VERSION) continue;

    const sql = fs.readFileSync(file, 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const rel = path.relative(process.cwd(), file);

    for (const table of ANON_PROTECTED_TABLES) {
      const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const grantsAnon = new RegExp(`\\bGRANT\\b[\\s\\S]{0,240}\\bON\\s+(?:TABLE\\s+)?(?:public\\.)?${escaped}\\b[\\s\\S]{0,240}\\bTO\\s+anon\\b`, 'i');
      const policyAnon = new RegExp(`\\bCREATE\\s+POLICY\\b[\\s\\S]{0,320}\\bON\\s+(?:public\\.)?${escaped}\\b[\\s\\S]{0,320}\\bTO\\s+anon\\b`, 'i');
      if (grantsAnon.test(sql)) {
        failures.push(`${rel}: re-grants anon privileges on protected table public.${table} after security cutover.`);
      }
      if (policyAnon.test(sql)) {
        failures.push(`${rel}: creates an anon RLS policy on protected table public.${table} after security cutover.`);
      }
    }

    const unsafeRefreshGrant = /\bGRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.refresh_doctoralia_funnel\s*\(\s*uuid\s*\)[\s\S]{0,160}\bTO\s+(?:PUBLIC|anon|authenticated)\b/i;
    if (unsafeRefreshGrant.test(sql)) {
      failures.push(`${rel}: re-exposes SECURITY DEFINER function refresh_doctoralia_funnel(uuid) to an untrusted role.`);
    }
  }
}

const migrationFiles = walkSqlFiles(MIGRATIONS_DIR);

for (const file of migrationFiles) {
  const sql = fs.readFileSync(file, 'utf8');
  const executableSql = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rel = path.relative(process.cwd(), file);

  if (/\.\.\.\s*(final\s+schema|schema|columns?)\s*\.\.\./i.test(executableSql) || /\(\s*\.\.\.\s*\)/.test(executableSql)) {
    failures.push(`${rel}: contains executable SQL placeholder ellipses; replace with real schema definitions.`);
  }

  const unsafeCronUnschedule = executableSql.match(/cron\.unschedule\(\s*'[^']+'\s*\)/g) || [];
  for (const call of unsafeCronUnschedule) {
    failures.push(`${rel}: uses unsafe ${call}; unschedule pg_cron jobs by jobid after selecting from cron.job.`);
  }

  const unsafeFinancialAlter = executableSql.match(/ALTER\s+TABLE\s+(?:public\.)?financial_settlements\b/gi) || [];
  for (const call of unsafeFinancialAlter) {
    failures.push(`${rel}: uses unsafe ${call}; use ALTER TABLE IF EXISTS or wrap in to_regclass('public.financial_settlements') guard.`);
  }

  const schemaQualifiedCreateIndex = executableSql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[a-z_][\w$]*\.[a-z_][\w$]*/gi) || [];
  for (const statement of schemaQualifiedCreateIndex) {
    failures.push(`${rel}: uses schema-qualified index name in ${statement}; keep the index identifier unqualified and schema-qualify the target table instead.`);
  }
}

assertSecurityCutover(migrationFiles);

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::${failure}`);
  process.exit(1);
}

console.log(`OK ${migrationFiles.length} Supabase SQL migrations passed placeholder, pg_cron, index-name, and terminal security guards`);
