import axios from 'axios';
import { supabase, isSupabaseAvailable } from '../lib/supabase/client';

const explicitApiUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;
const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

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

// On Vercel (production) we rely on the /api/* rewrite in vercel.json to proxy
// requests to the Supabase Edge Function. Using the full Supabase URL as baseURL
// causes axios to send root-relative /api/* paths directly to the Supabase host,
// bypassing /functions/v1 entirely. Empty baseURL keeps requests on the same origin
// so the Vercel proxy rewrite fires correctly.
const defaultApiUrl = explicitApiUrl || (isLocalHost ? '/api' : '');
// Prefer new publishable key; fall back to legacy anon key for existing setups.
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  '';

const api = axios.create({
  baseURL: normalizeApiBaseUrl(defaultApiUrl),
  timeout: 15000,
  headers: supabaseKey ? { apikey: supabaseKey } : {},
});

let lastUnauthorizedEventAt = 0;

api.interceptors.request.use(async (config) => {
  const baseUrl = config.baseURL || '';
  if (typeof config.url === 'string' && config.url.startsWith('/api/') && /\/api\/?$/.test(baseUrl)) {
    // If baseURL already ends in /api, drop the extra /api prefix from request path.
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

  // 2. Fall back to backend JWT stored in localStorage
  if (!token) {
    token = localStorage.getItem('nuvanx_token');
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    // debug logs enabled only in development or when explicitly requested
    if (import.meta.env.DEV) {
      console.debug(`[API] ${config.method?.toUpperCase()} ${config.url} — Auth token injected`);
    }
  } else {
    if (import.meta.env.DEV) {
      console.debug(`[API] ${config.method?.toUpperCase()} ${config.url} — No auth token available`);
    }
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const isAuthEndpoint = error.config?.url?.includes('/api/auth/');
      if (!isAuthEndpoint && window.location.pathname !== '/login') {
        localStorage.removeItem('nuvanx_token');

        // Avoid hard browser reload loops. Let React auth state drive navigation.
        const now = Date.now();
        if (now - lastUnauthorizedEventAt > 1000) {
          lastUnauthorizedEventAt = now;
          window.dispatchEvent(
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
