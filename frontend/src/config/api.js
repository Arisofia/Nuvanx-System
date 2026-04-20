import axios from 'axios';
import { supabase, isSupabaseAvailable } from '../lib/supabase/client';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const explicitApiUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;
const fallbackSupabaseApiUrl = 'https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1';
const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

function normalizeApiBaseUrl(url) {
  if (!url) return url;
  const trimmed = url.replace(/\/+$/, '');

  // Local dev proxy mode: keep /api as base.
  if (/^\/api(?:\/|$)/.test(trimmed)) return '/api';

  // Canonical Supabase functions base should always end at /functions/v1.
  const fnIdx = trimmed.indexOf('/functions/v1');
  if (fnIdx >= 0) return trimmed.slice(0, fnIdx + '/functions/v1'.length);

  // Fallback: strip accidental deep /api paths from env values.
  return trimmed.replace(/\/api(?:\/.*)?$/, '');
}

const defaultApiUrl = explicitApiUrl
  || (supabaseUrl ? `${supabaseUrl}/functions/v1` : (isLocalHost ? '/api' : fallbackSupabaseApiUrl));
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const api = axios.create({
  baseURL: normalizeApiBaseUrl(defaultApiUrl),
  timeout: 15000,
  headers: supabaseAnonKey ? { apikey: supabaseAnonKey } : {},
});

let lastUnauthorizedEventAt = 0;

api.interceptors.request.use(async (config) => {
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
