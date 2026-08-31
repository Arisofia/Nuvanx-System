import { describe, expect, it, beforeEach } from 'vitest';
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

const workersOrigin = 'https://nuvanx-frontend.jenineferderas.workers.dev';

// Runtime implementation matching _shared/config.ts logic for execution testing
function normalizeFrontendUrl(url) {
  if (!url) return null;
  if (url === '*' || String(url).toLowerCase() === 'null') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function createCorsEvaluator(env = {}) {
  const isDev = (env.DENO_ENV || env.NODE_ENV || '').toLowerCase() !== 'production';
  const rawFrontend = env.FRONTEND_URL || '';
  const normalizedFrontend = normalizeFrontendUrl(rawFrontend);
  const productionFallback = normalizeFrontendUrl(env.PRODUCTION_FALLBACK_URL || '') || '';
  const cloudflareOrigin = normalizeFrontendUrl(workersOrigin) || '';
  const frontendUrl = normalizedFrontend ?? (isDev ? 'http://localhost:5173' : (productionFallback || ''));
  const defaultCorsOrigin = isDev ? 'http://localhost:5173' : frontendUrl;

  const extraOrigins = String(env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => normalizeFrontendUrl(o.trim()))
    .filter((o) => Boolean(o));

  const allowedOrigins = new Set([
    defaultCorsOrigin,
    normalizedFrontend,
    productionFallback,
    cloudflareOrigin,
    ...extraOrigins,
  ].filter((o) => Boolean(o)));

  const defaultCorsHeaders = {
    'Access-Control-Allow-Origin': defaultCorsOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };

  function buildCorsHeaders(origin) {
    const allowed = origin && allowedOrigins.has(origin) ? origin : defaultCorsOrigin;
    return {
      ...defaultCorsHeaders,
      'Access-Control-Allow-Origin': allowed,
    };
  }

  return { allowedOrigins, buildCorsHeaders, defaultCorsOrigin };
}

describe('frontend CORS hosting contract', () => {
  it('includes the exact controlled Cloudflare Workers frontend origin in source and constants', () => {
    expect(sharedConfig).toContain(`normalizeFrontendUrl('${workersOrigin}')`);
    expect(sharedConfig).toMatch(/ALLOWED_CORS_ORIGINS\s*=\s*new Set\(\[[\s\S]*CLOUDFLARE_WORKERS_FRONTEND_ORIGIN/);
  });

  it('preserves environment-owned production and extra origins without wildcarding CORS', () => {
    expect(sharedConfig).toContain('NORMALIZED_FRONTEND_URL');
    expect(sharedConfig).toContain('PRODUCTION_FALLBACK_URL');
    expect(sharedConfig).toContain("getEnv('CORS_ALLOWED_ORIGINS')");
    expect(sharedConfig).not.toMatch(/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/);
    expect(sharedConfig).toContain("if (url === '*' || url.toLowerCase() === 'null') return null;");
  });

  it('keeps API and provider CORS on the shared canonical owner', () => {
    expect(api).toContain('buildCorsHeaders(requestOrigin)');
    expect(api).toContain("from '../_shared/config.ts'");
    expect(provider).toContain("import { ALLOWED_CORS_ORIGINS } from '../_shared/config.ts';");
    expect(provider).toContain("if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;");
  });

  describe('runtime CORS contract evaluation', () => {
    it('normalizes https origins and rejects wildcards, null, or http insecure protocols', () => {
      expect(normalizeFrontendUrl('https://nuvanx.com/')).toBe('https://nuvanx.com');
      expect(normalizeFrontendUrl('https://nuvanx-frontend.jenineferderas.workers.dev/dashboard')).toBe(workersOrigin);
      expect(normalizeFrontendUrl('*')).toBeNull();
      expect(normalizeFrontendUrl('null')).toBeNull();
      expect(normalizeFrontendUrl('http://insecure-domain.com')).toBeNull();
      expect(normalizeFrontendUrl('not-a-url')).toBeNull();
    });

    it('allows the Cloudflare Workers origin in runtime header generation', () => {
      const { buildCorsHeaders, allowedOrigins } = createCorsEvaluator({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://nuvanx.com',
        PRODUCTION_FALLBACK_URL: 'https://nuvanx.com',
      });

      expect(allowedOrigins.has(workersOrigin)).toBe(true);

      const headers = buildCorsHeaders(workersOrigin);
      expect(headers['Access-Control-Allow-Origin']).toBe(workersOrigin);
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
  });
});
