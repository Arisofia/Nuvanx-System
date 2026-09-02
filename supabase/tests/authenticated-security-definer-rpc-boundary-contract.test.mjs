import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migrationsDir = path.resolve('supabase/migrations');
const boundaryFile = '20260902124732_harden_authenticated_security_definer_rpc_surface_v2.sql';
const boundary = fs.readFileSync(path.join(migrationsDir, boundaryFile), 'utf8').toLowerCase();

const rpcNames = [
  'nvx_get_attribution_health',
  'nvx_get_control_centre_lead_timeline',
  'nvx_get_control_centre_pipeline',
  'nvx_get_dashboard_metrics_v2',
  'nvx_get_hubspot_marketing_contact_monitor',
  'nvx_set_lead_pipeline_state',
];

const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function publicRpcSecurityStatements(sql, name) {
  const escapedName = escapeRegExp(name);
  const pattern = new RegExp(
    `(?:create\\s+(?:or\\s+replace\\s+)?|alter\\s+)function\\s+public\\.${escapedName}\\s*\\([^;]*?\\)[\\s\\S]*?(?=;|$)`,
    'gi',
  );
  return [...sql.matchAll(pattern)].map((match) => match[0].toLowerCase());
}

describe('Authenticated SECURITY DEFINER RPC boundary', () => {
  it('moves privileged implementations out of public and exposes invoker wrappers only', () => {
    expect(boundary).toContain('create schema if not exists private authorization postgres');
    expect(boundary).toContain('revoke all on schema private from public');
    expect(boundary).toContain('revoke all on schema private from anon');
    expect(boundary).toContain('grant usage on schema private to authenticated, service_role');

    for (const name of rpcNames) {
      expect(boundary).toContain(`alter function public.${name}`);
      expect(boundary).toContain('set schema private');
      expect(boundary).toContain(`create function public.${name}`);
      expect(boundary).toContain(`private.${name}`);
    }

    // Count SQL declarations, not prose/comments mentioning SECURITY INVOKER.
    const publicWrapperCount = (boundary.match(/language sql\s+security invoker/g) ?? []).length;
    expect(publicWrapperCount).toBe(6);
  });

  it('keeps anon closed while preserving authenticated and service-role RPC execution', () => {
    for (const name of rpcNames) {
      expect(boundary).toContain(`revoke all on function public.${name}`);
      expect(boundary).toContain(`grant execute on function public.${name}`);
      expect(boundary).toContain('to authenticated, service_role');
      expect(boundary).toContain(`revoke all on function private.${name}`);
      expect(boundary).toContain(`grant execute on function private.${name}`);
    }
  });

  it('fails if a later migration makes any exposed public RPC SECURITY DEFINER', () => {
    const boundaryIndex = migrationFiles.indexOf(boundaryFile);
    expect(boundaryIndex).toBeGreaterThanOrEqual(0);

    for (const file of migrationFiles.slice(boundaryIndex + 1)) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      for (const name of rpcNames) {
        const statements = publicRpcSecurityStatements(sql, name);
        for (const statement of statements) {
          expect(
            /\bsecurity\s+definer\b/i.test(statement),
            `${file} reopens ${name} as an exposed SECURITY DEFINER RPC`,
          ).toBe(false);
        }
      }
    }
  });
});