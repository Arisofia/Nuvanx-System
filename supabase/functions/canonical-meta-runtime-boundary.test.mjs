import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const boundary = readFileSync('supabase/functions/_shared/canonical-meta-runtime.ts', 'utf8');
const canonicalRuntimes = [
  'meta-lead-backfill',
  'meta-daily-insights',
  'meta-routing-audit',
  'meta-leadgen-subscribe',
];

describe('canonical meta_ads App Secret runtime boundary', () => {
  it('requires the governed canonical secret and strips historical aliases before runtime import', () => {
    expect(boundary).toContain("const CANONICAL_APP_SECRET = 'META_CANONICAL_APP_SECRET'");
    expect(boundary).toContain("['META_REPORTING_APP_SECRET', 'META_APP_SECRET']");
    expect(boundary).toContain('if (!canonical)');
    expect(boundary).toContain('Deno.env.delete(alias)');
  });

  for (const runtime of canonicalRuntimes) {
    it(`${runtime} exposes only the canonical boundary as its deployed entrypoint`, () => {
      const entrypoint = readFileSync(`supabase/functions/${runtime}/index.ts`, 'utf8');
      const implementation = readFileSync(`supabase/functions/${runtime}/runtime.ts`, 'utf8');

      expect(entrypoint).toContain("import { enforceCanonicalMetaRuntimeBoundary } from '../_shared/canonical-meta-runtime.ts'");
      expect(entrypoint).toContain('enforceCanonicalMetaRuntimeBoundary();');
      expect(entrypoint).toContain("await import('./runtime.ts');");
      expect(entrypoint).not.toContain('META_REPORTING_APP_SECRET');
      expect(entrypoint).not.toContain('META_APP_SECRET');
      expect(implementation.length).toBeGreaterThan(1000);
    });
  }
});
