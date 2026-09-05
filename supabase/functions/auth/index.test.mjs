import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const authSource = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
const apiSource = readFileSync(fileURLToPath(new URL('../api/index.ts', import.meta.url)), 'utf8');
const mirrorMigration = readFileSync('supabase/migrations/20260905144500_reconcile_auth_user_profile_mirror.sql', 'utf8');

describe('Supabase Auth user mirror contract', () => {
  it('routes public registration through standard Supabase Auth without service-role mirroring', () => {
    expect(authSource).not.toContain('password_hash');
    expect(apiSource).not.toContain('password_hash:');
    expect(authSource).not.toContain('auth.admin.createUser');
    expect(authSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(authSource).not.toContain("from('users').upsert");
    expect(authSource).toContain('publicAuth.auth.signUp');
    expect(authSource).toContain('SUPABASE_ANON_KEY');
  });

  it('owns the public.users mirror transactionally in the versioned auth.users trigger', () => {
    expect(mirrorMigration).toContain('CREATE OR REPLACE FUNCTION public.handle_auth_user_change()');
    expect(mirrorMigration).toContain('AFTER INSERT OR DELETE OR UPDATE ON auth.users');
    expect(mirrorMigration).toContain('EXECUTE FUNCTION public.handle_auth_user_change()');
    expect(mirrorMigration).toContain('INSERT INTO public.users');
    expect(mirrorMigration).not.toContain('password_hash');
  });

  it('cannot create a phantom public.users row for an obfuscated duplicate signup', () => {
    expect(authSource).toContain('No auth.users INSERT occurs in that case');
    expect(authSource).not.toContain('authData.user.id');
    expect(authSource).not.toContain("admin.from('users')");
    expect(mirrorMigration).toContain('AFTER INSERT OR DELETE OR UPDATE ON auth.users');
  });

  it('validates request-body shape and field types before password access', () => {
    expect(authSource).toContain("typeof body !== 'object'");
    expect(authSource).toContain('Array.isArray(body)');
    expect(authSource).toContain("typeof email !== 'string'");
    expect(authSource).toContain("typeof password !== 'string'");
    expect(authSource).toContain("typeof name !== 'string'");
    expect(authSource.indexOf("typeof password !== 'string'")).toBeLessThan(authSource.indexOf('password.length < 8'));
  });

  it('does not persist server-side auth sessions', () => {
    expect(authSource).toContain('autoRefreshToken: false');
    expect(authSource).toContain('persistSession: false');
    expect(authSource).toContain('detectSessionInUrl: false');
  });

  it('uses the shared origin-aware CORS policy', () => {
    expect(authSource).toContain("buildCorsHeaders(req.headers.get('Origin'))");
    expect(authSource).not.toContain("'Access-Control-Allow-Origin': '*'");
  });
});
