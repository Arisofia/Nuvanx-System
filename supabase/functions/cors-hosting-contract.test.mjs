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

const workersOrigin = 'https://nuvanx-frontend.jenineferderas.workers.dev';

describe('frontend CORS hosting contract', () => {
  it('includes the exact controlled Cloudflare Workers frontend origin', () => {
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
});
