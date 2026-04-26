import axios from 'axios';
import { supabase, isSupabaseAvailable } from '../lib/supabase/client';

const explicitApiUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;
const currentHostname = typeof globalThis.window !== 'undefined' ? globalThis.window.location.hostname : '';
const isLocalHost = ['localhost', '127.0.0.1'].includes(currentHostname);

function normalizeApiBaseUrl(url) {
  if (!url) return url;
  const trimmed = url.replace(/\/+$/, '');

  // Local dev proxy mode: frontend already calls /api/* paths.
  // Keep empty base to avoid /api/api/* duplication.
  if (/^\/api(?:\/|$)/.test(trimmed)) return '';

  // Canonical Supabase functions base should always end at /functions/v1.
  const fnIdx = trimmed.indexOf('/functions/v1');
  if (fnIdx >= 0) return trimmed.slice(0, fnIdx + '/functions/v1'.length);

  // Fallback: strip accidental deep /api paths from env values.
  return trimmed.replace(/\/api(?:\/.*)?$/, '');
}

function shouldUseProxyApi(explicitUrl) {
  if (!explicitUrl) return false;
  try {
    const parsed = new URL(explicitUrl);
    const isSupabaseFunctionsUrl = parsed.pathname.endsWith('/functions/v1/api');
    const isDifferentOrigin = currentHostname && parsed.hostname !== currentHostname;
    return isSupabaseFunctionsUrl && isDifferentOrigin;
  } catch {
    return false;
  }
}

function getDefaultApiUrl(explicitUrl) {
  if (shouldUseProxyApi(explicitUrl)) return '';
  if (explicitUrl) return explicitUrl;
  return isLocalHost ? '/api' : '';
}

// Prefer the Vercel rewrite path in production when the configured API URL points
// to the Supabase functions host from a different origin.
const defaultApiUrl = getDefaultApiUrl(explicitApiUrl);
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

// Prefer new publishable key; fall back to legacy anon key for existing setups.
function cleanEnvValue(value) {
  if (!value) return '';
  const raw = String(value);
  const stripped = raw.replace(/(^['"]|['"]$)/g, '');
  return stripped.replace(/[\r\n\t]+/g, '').trim();
}

const supabaseKey = cleanEnvValue(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY || ''
);

const apiBaseUrl = normalizeApiBaseUrl(defaultApiUrl);
const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 15000,
  headers: supabaseKey ? { apikey: supabaseKey } : {},
});

let inMemoryAuthToken = null;

export function setAuthToken(jwt) {
  inMemoryAuthToken = jwt;
}

export function clearAuthToken() {
  inMemoryAuthToken = null;
}

export const apiConfig = {
  explicitApiUrl,
  defaultApiUrl,
  apiBaseUrl,
  supabaseKey,
  supabaseUrl,
};

let lastUnauthorizedEventAt = 0;

api.interceptors.request.use(async (config) => {
  const baseUrl = config.baseURL || '';
  const isDirectSupabaseFunctionsApi = /\/functions\/v1\/api$/.test(baseUrl);
  if (typeof config.url === 'string' && config.url.startsWith('/api/') && (/\/api\/?$/.test(baseUrl) || isDirectSupabaseFunctionsApi)) {
    // If baseURL already ends in /api or points to the Supabase functions API path,
    // drop the extra /api prefix from the request path.
    config.url = config.url.slice(4);
  }

  let token = null;

  if (isSupabaseAvailable()) {
    try {
      // 1. Try to get the session from the current Supabase client state (synchronous-ish)
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token;
    } catch (e) {
      console.warn('[API] Failed to get Supabase session token:', e);
    }
  }

  // 2. Fall back to backend JWT stored in memory only
  if (!token) {
    token = inMemoryAuthToken;
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    // debug logs enabled only in development or when explicitly requested
    if (import.meta.env.DEV) {
      console.debug(`[API] ${config.method?.toUpperCase()} ${config.url} — Auth token injected`);
    }
  } else if (import.meta.env.DEV) {
    console.debug(`[API] ${config.method?.toUpperCase()} ${config.url} — No auth token available`);
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const isAuthEndpoint = error.config?.url?.includes('/api/auth/');
      const currentPath = typeof globalThis.window !== 'undefined' ? globalThis.window.location.pathname : '';
      if (!isAuthEndpoint && currentPath !== '/login') {
        clearAuthToken();

        // Avoid hard browser reload loops. Let React auth state drive navigation.
        const now = Date.now();
        if (now - lastUnauthorizedEventAt > 1000) {
          lastUnauthorizedEventAt = now;
          globalThis.window?.dispatchEvent(
            new CustomEvent('nuvanx:unauthorized', {
              detail: { url: error.config?.url || null },
            })
          );
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
