#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase/migrations');
const failures = [];

function walkSqlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkSqlFiles(fullPath);
      return entry.isFile() && entry.name.endsWith('.sql') ? [fullPath] : [];
    })
    .sort();
}

for (const file of walkSqlFiles(MIGRATIONS_DIR)) {
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

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::${failure}`);
  process.exit(1);
}

console.log(`OK ${walkSqlFiles(MIGRATIONS_DIR).length} Supabase SQL migrations passed placeholder, pg_cron, and index-name guards`);
