/**
 * Pure, environment-injectable CORS evaluator and URL normalization core.
 * Free of runtime Deno/Node globals at import time so it can be safely imported
 * in both Deno Edge Functions and Node/Vitest contract test suites.
 */

export function normalizeFrontendUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed || trimmed === '*' || trimmed.toLowerCase() === 'null') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export interface CorsEvaluatorOptions {
  DENO_ENV?: string;
  NODE_ENV?: string;
  FRONTEND_URL?: string;
  PRODUCTION_FALLBACK_URL?: string;
  CORS_ALLOWED_ORIGINS?: string;
}

export function createCorsEvaluator(env: CorsEvaluatorOptions = {}) {
  const get = (name: keyof CorsEvaluatorOptions): string => {
    const value = env[name];
    return typeof value === 'string' ? value.trim() : '';
  };

  const isDev = (get('DENO_ENV') || get('NODE_ENV')).toLowerCase() !== 'production';
  const rawFrontend = get('FRONTEND_URL');
  const normalizedFrontend = normalizeFrontendUrl(rawFrontend);
  const productionFallback = normalizeFrontendUrl(get('PRODUCTION_FALLBACK_URL')) || '';
  const frontendUrl = normalizedFrontend ?? (isDev ? 'http://localhost:5173' : (productionFallback || ''));
  const defaultCorsOrigin = isDev ? 'http://localhost:5173' : frontendUrl;

  const extraOrigins = get('CORS_ALLOWED_ORIGINS')
    .split(',')
    .map((o) => normalizeFrontendUrl(o.trim()))
    .filter((o): o is string => Boolean(o));

  const allowedOrigins = new Set([
    defaultCorsOrigin,
    normalizedFrontend,
    productionFallback,
    ...extraOrigins,
  ].filter((o): o is string => Boolean(o)));

  const defaultCorsHeaders = {
    'Access-Control-Allow-Origin': defaultCorsOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };

  function buildCorsHeaders(origin: string | null) {
    const allowed = origin && allowedOrigins.has(origin) ? origin : defaultCorsOrigin;
    return {
      ...defaultCorsHeaders,
      'Access-Control-Allow-Origin': allowed,
    };
  }

  return {
    isDev,
    rawFrontend,
    normalizedFrontend,
    productionFallback,
    frontendUrl,
    defaultCorsOrigin,
    allowedOrigins,
    defaultCorsHeaders,
    buildCorsHeaders,
  };
}
