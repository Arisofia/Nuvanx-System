import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const authSource = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
const apiSource = readFileSync(fileURLToPath(new URL('../api/index.ts', import.meta.url)), 'utf8');

describe('Supabase Auth user mirror contract', () => {
  it('stores identity metadata only in public.users', () => {
    expect(authSource).not.toContain('password_hash');
    expect(apiSource).not.toContain('password_hash:');
    expect(authSource).toContain("auth.admin.createUser");
    expect(authSource).toContain("from('users').upsert");
  });

  it('uses the shared origin-aware CORS policy', () => {
    expect(authSource).toContain("buildCorsHeaders(req.headers.get('Origin'))");
    expect(authSource).not.toContain("'Access-Control-Allow-Origin': '*'");
  });
});