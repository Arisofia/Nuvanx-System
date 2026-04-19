import axios from 'axios';
import { supabase, isSupabaseAvailable } from '../lib/supabase/client';

// If no explicit API URL is provided, use Supabase edge function (free deployment).
const DEFAULT_API_URL = 'https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdnZ1dXlzZ3h5cXZtb3ZybHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxOTIxOTYsImV4cCI6MjA5MTc2ODE5Nn0.5VslHXbyEidKqZassAZCBLeUYd2_MWSmOHl3fFrvTRo';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || DEFAULT_API_URL,
  timeout: 15000,
  headers: {
    // Public anon key is safe to include and harmless for backend requests.
    apikey: SUPABASE_ANON_KEY,
  },
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
