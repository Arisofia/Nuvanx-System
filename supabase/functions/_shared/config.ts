/** @ts-ignore: Deno global is provided by Supabase Edge Runtime */
declare const Deno: any;

export function getEnv(name: string): string {
  const value = Deno.env.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function requireRuntimeSecret(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`${name} is required. Refusing to run with missing Supabase runtime configuration.`);
  }
  return value;
}

export const IS_DEVELOPMENT = (getEnv('DENO_ENV') || getEnv('NODE_ENV')).toLowerCase() !== 'production';

export const SUPABASE_URL = getEnv('SUPABASE_URL');
export const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
export const SUPABASE_ANON_KEY = getEnv('SUPABASE_ANON_KEY');
export const NUVANX_SUPABASE_SERVICE_ROLE_KEY = getEnv('NUVANX_SUPABASE_SERVICE_ROLE_KEY');
export const MCP_API_KEY = getEnv('MCP_API_KEY');
export const ENCRYPTION_KEY = getEnv('ENCRYPTION_KEY');
export const META_APP_SECRET = getEnv('META_APP_SECRET');

export function normalizeFrontendUrl(url: string): string | null {
  if (!url) return null;
  if (url === '*' || url.toLowerCase() === 'null') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export const RAW_FRONTEND_URL = getEnv('FRONTEND_URL');
export const NORMALIZED_FRONTEND_URL = normalizeFrontendUrl(RAW_FRONTEND_URL);

// Hard-coded production Vercel URL as a CORS safety-net in case FRONTEND_URL secret is misconfigured.
export const PRODUCTION_FALLBACK_URL = 'https://frontend-arisofias-projects-c2217452.vercel.app';
export const FRONTEND_URL = NORMALIZED_FRONTEND_URL ?? (IS_DEVELOPMENT ? 'http://localhost:5173' : PRODUCTION_FALLBACK_URL);

export const DEFAULT_CORS_ORIGIN = IS_DEVELOPMENT
  ? 'http://localhost:5173'
  : FRONTEND_URL;

export const ALLOWED_CORS_ORIGINS = new Set([
  DEFAULT_CORS_ORIGIN,
  // Always include the production Vercel URL regardless of NODE_ENV so that
  // POST requests from the browser (which send Origin) are never rejected in production.
  PRODUCTION_FALLBACK_URL,
  'https://nuvanx.com',
  'https://www.nuvanx.com',
]);

export const DEFAULT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': DEFAULT_CORS_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

export function buildCorsHeaders(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_CORS_ORIGINS.has(origin)
    ? origin
    : DEFAULT_CORS_ORIGIN;
  return {
    ...DEFAULT_CORS_HEADERS,
    'Access-Control-Allow-Origin': allowedOrigin,
  };
}
