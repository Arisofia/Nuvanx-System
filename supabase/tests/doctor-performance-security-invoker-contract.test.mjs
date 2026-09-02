import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migrationsDir = path.resolve('supabase/migrations');
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const history = migrationFiles
  .map((name) => `\n-- FILE:${name}\n${fs.readFileSync(path.join(migrationsDir, name), 'utf8')}`)
  .join('\n');

const viewCreatePattern = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.vw_doctor_performance_real\b/gi;
const invokerPattern = /ALTER\s+VIEW\s+(?:IF\s+EXISTS\s+)?public\.vw_doctor_performance_real\s+SET\s*\(\s*security_invoker\s*=\s*true\s*\)/gi;
const revokeAnonPattern = /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+public\.vw_doctor_performance_real\s+FROM\s+PUBLIC\s*,\s*anon\s*;/gi;
const grantAuthenticatedSelectPattern = /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.vw_doctor_performance_real\s+TO\s+authenticated\s*,\s*service_role\s*;/gi;

function lastMatchIndex(pattern) {
  let last = -1;
  for (const match of history.matchAll(pattern)) last = match.index;
  return last;
}

describe('Doctor performance reporting security boundary', () => {
  it('reasserts SECURITY INVOKER after the latest view recreation', () => {
    const lastCreate = lastMatchIndex(viewCreatePattern);
    const lastInvoker = lastMatchIndex(invokerPattern);

    expect(lastCreate).toBeGreaterThan(-1);
    expect(lastInvoker).toBeGreaterThan(lastCreate);
  });

  it('keeps anonymous callers off the reporting view after the latest recreation', () => {
    const lastCreate = lastMatchIndex(viewCreatePattern);
    const lastAnonRevoke = lastMatchIndex(revokeAnonPattern);

    expect(lastAnonRevoke).toBeGreaterThan(lastCreate);
  });

  it('preserves read-only access for authenticated and service-role reporting consumers', () => {
    const lastCreate = lastMatchIndex(viewCreatePattern);
    const lastSelectGrant = lastMatchIndex(grantAuthenticatedSelectPattern);

    expect(lastSelectGrant).toBeGreaterThan(lastCreate);
  });
});
