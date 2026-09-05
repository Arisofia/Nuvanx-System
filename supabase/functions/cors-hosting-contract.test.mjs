import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sharedConfig = readFileSync(
  fileURLToPath(new URL('./_shared/config.ts', import.meta.url)),
  'utf8',
);
const api = readFileSync(
  fileURLToPath(new URL('./api/index.ts', import.meta.url)),
  'utf8',
);
const provider = readFileSync(
  fileURLToPath(new URL('./control-centre-provider/index.ts', import.meta.url)),
  'utf8',
);
const publicFunctions = ['agent-run', 'auth', 'health', 'playbooks'].map((name) => ({
  name,
  source: readFileSync(fileURLToPath(new URL(`./${name}/index.ts`, import.meta.url)), 'utf8'),
}));

import {
  normalizeFrontendUrl,
  createCorsEvaluator,
} from './_shared/cors-core.ts';

const workersOrigin = 'https://nuvanx-frontend.jenineferderas.workers.dev';

describe('frontend CORS hosting contract', () => {
  it('keeps all production frontend origins environment-owned', () => {
    expect(sharedConfig).not.toContain("normalizeFrontendUrl('https://nuvanx-frontend.jenineferderas.workers.dev')");
    expect(sharedConfig).not.toContain('CLOUDFLARE_WORKERS_FRONTEND_ORIGIN');
    expect(sharedConfig).toContain("getEnv('CORS_ALLOWED_ORIGINS')");
    expect(sharedConfig).toMatch(/ALLOWED_CORS_ORIGINS\s*=\s*new Set\(\[[\s\S]*EXTRA_CORS_ORIGINS/);
  });

  it('preserves environment-owned production and extra origins without wildcarding CORS', () => {
    expect(sharedConfig).toContain('NORMALIZED_FRONTEND_URL');
    expect(sharedConfig).toContain('PRODUCTION_FALLBACK_URL');
    expect(sharedConfig).toContain("getEnv('CORS_ALLOWED_ORIGINS')");
    expect(sharedConfig).not.toMatch(/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/);
    expect(sharedConfig).toContain("trimmed.toLowerCase() === 'null'");
  });

  it('keeps API and provider CORS on the shared canonical owner', () => {
    expect(api).toContain('buildCorsHeaders(requestOrigin)');
    expect(api).toContain("from '../_shared/config.ts'");
    expect(provider).toContain("import { ALLOWED_CORS_ORIGINS } from '../_shared/config.ts';");
    expect(provider).toContain("if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;");
  });

  it('keeps public Edge Functions off wildcard CORS', () => {
    for (const { name, source } of publicFunctions) {
      expect(source, `${name} must use the shared CORS policy`).toContain('buildCorsHeaders');
      expect(source).not.toMatch(/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/);
    }
  });

  describe('runtime CORS contract evaluation', () => {
    it('normalizes https origins and rejects wildcards, null, or http insecure protocols', () => {
      expect(normalizeFrontendUrl('https://nuvanx.com/')).toBe('https://nuvanx.com');
      expect(normalizeFrontendUrl(`${workersOrigin}/dashboard`)).toBe(workersOrigin);
      expect(normalizeFrontendUrl('*')).toBeNull();
      expect(normalizeFrontendUrl('null')).toBeNull();
      expect(normalizeFrontendUrl('http://insecure-domain.com')).toBeNull();
      expect(normalizeFrontendUrl('not-a-url')).toBeNull();
    });

    it('allows the Cloudflare Workers origin only when supplied by environment', () => {
      const withoutExtra = createCorsEvaluator({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://nuvanx.com',
        PRODUCTION_FALLBACK_URL: 'https://nuvanx.com',
      });
      expect(withoutExtra.allowedOrigins.has(workersOrigin)).toBe(false);

      const configured = createCorsEvaluator({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://nuvanx.com',
        PRODUCTION_FALLBACK_URL: 'https://nuvanx.com',
        CORS_ALLOWED_ORIGINS: `${workersOrigin},https://frontend.example.com`,
      });
      expect(configured.allowedOrigins.has(workersOrigin)).toBe(true);
      expect(configured.buildCorsHeaders(workersOrigin)['Access-Control-Allow-Origin']).toBe(workersOrigin);
    });

    it('falls back to default origin when receiving unknown or untrusted origin', () => {
      const { buildCorsHeaders, defaultCorsOrigin } = createCorsEvaluator({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://nuvanx.com',
      });

      const untrustedHeaders = buildCorsHeaders('https://evil-attacker.com');
      expect(untrustedHeaders['Access-Control-Allow-Origin']).toBe(defaultCorsOrigin);
      expect(untrustedHeaders['Access-Control-Allow-Origin']).not.toBe('https://evil-attacker.com');
      expect(untrustedHeaders['Access-Control-Allow-Origin']).not.toBe('*');
    });

    it('retires legacy Vercel origins from frontend and fallback configuration', () => {
      const legacyVercelOrigin = ['https://', 'frontend-arisofias-projects-c2217452', '.vercel', '.app'].join('');
      const legacyVercelMain = ['https://', 'frontend-git-main-arisofias-projects-c2217452', '.vercel', '.app'].join('');

      expect(normalizeFrontendUrl(legacyVercelOrigin)).toBeNull();
      expect(normalizeFrontendUrl(legacyVercelMain)).toBeNull();

      const retiredEvaluator = createCorsEvaluator({
        NODE_ENV: 'production',
        FRONTEND_URL: legacyVercelOrigin,
        PRODUCTION_FALLBACK_URL: legacyVercelMain,
        CORS_ALLOWED_ORIGINS: workersOrigin,
      });

      expect(retiredEvaluator.allowedOrigins.has(legacyVercelOrigin)).toBe(false);
      expect(retiredEvaluator.allowedOrigins.has(legacyVercelMain)).toBe(false);
      expect(retiredEvaluator.allowedOrigins.has(workersOrigin)).toBe(true);
      expect(retiredEvaluator.defaultCorsOrigin).toBe(workersOrigin);
      expect(retiredEvaluator.buildCorsHeaders(legacyVercelOrigin)['Access-Control-Allow-Origin']).toBe(workersOrigin);
    });
  });
});
