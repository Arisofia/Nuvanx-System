import axios from 'axios';
import { supabase, isSupabaseAvailable } from '../lib/supabase/client';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const defaultApiUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/api` : '/api';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const api = axios.create({
  baseURL: '/api',
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
