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

function shouldUseProxyApi(explicitUrl) {
  if (typeof window === 'undefined' || !explicitUrl) return false;
  try {
    const parsed = new URL(explicitUrl);
    const isSupabaseFunctionsUrl = parsed.pathname.endsWith('/functions/v1/api');
    const isDifferentOrigin = parsed.hostname !== window.location.hostname;
    return isSupabaseFunctionsUrl && isDifferentOrigin;
  } catch {
    return false;
  }
}

// Prefer the Vercel rewrite path in production when the configured API URL points
// to the Supabase functions host from a different origin.
const defaultApiUrl = shouldUseProxyApi(explicitApiUrl)
  ? ''
  : explicitApiUrl || (isLocalHost ? '/api' : '');
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
  const isDirectSupabaseFunctionsApi = /\/functions\/v1\/api$/.test(baseUrl);
  if (typeof config.url === 'string' && config.url.startsWith('/api/') && (/\/api\/?$/.test(baseUrl) || isDirectSupabaseFunctionsApi)) {
    // If baseURL already ends in /api or points to the Supabase functions API path,
    // drop the extra /api prefix from the request path.
    config.url = config.url.slice(4);
  }

  let token;
  if (isSupabaseAvailable()) {
    // Prefer the Supabase session token (auto-refreshed by Supabase JS)
    const { data: { session } } = await supabase.auth.getSession();
    token = session?.access_token;
  }
  // Fall back to backend JWT stored in localStorage (used when login went via
  // the backend-JWT path, e.g. user exists in public.users but not in Supabase Auth)
  if (!token) {
    token = localStorage.getItem('nuvanx_token');
  }
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
