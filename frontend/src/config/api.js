import axios from 'axios';
import { supabase, isSupabaseAvailable } from '../lib/supabase/client';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  timeout: 10000,
});

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
        if (!isSupabaseAvailable()) {
          localStorage.removeItem('nuvanx_token');
        }
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
