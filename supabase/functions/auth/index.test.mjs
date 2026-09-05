import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const authSource = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
const apiSource = readFileSync(fileURLToPath(new URL('../api/index.ts', import.meta.url)), 'utf8');

describe('Supabase Auth user mirror contract', () => {
  it('routes public registration through standard Supabase Auth before using service role for the mirror', () => {
    expect(authSource).not.toContain('password_hash');
    expect(apiSource).not.toContain('password_hash:');
    expect(authSource).not.toContain('auth.admin.createUser');
    expect(authSource).toContain('publicAuth.auth.signUp');
    expect(authSource).toContain('SUPABASE_ANON_KEY');
    expect(authSource).toContain("admin.from('users').upsert");
    expect(authSource.indexOf('publicAuth.auth.signUp')).toBeLessThan(authSource.indexOf("admin.from('users').upsert"));
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
