import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseAvailable } from '../lib/supabase/client';
import api from '../config/api';
import { AuthContext } from './authContext';

export { AuthContext };

function toUserShape(sbUser) {
  return {
    id: sbUser.id,
    email: sbUser.email,
    name: sbUser.user_metadata?.name || sbUser.email,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onUnauthorized = async () => {
      if (isSupabaseAvailable()) {
        await supabase.auth.signOut();
      }
      localStorage.removeItem('nuvanx_token');
      setToken(null);
      setUser(null);
    };

    window.addEventListener('nuvanx:unauthorized', onUnauthorized);

    if (isSupabaseAvailable()) {
      // Bootstrap from current Supabase session (persists across refreshes)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setToken(session.access_token);
          setUser(toUserShape(session.user));
        }
        setLoading(false);
      });

      // Keep state in sync when Supabase refreshes the token or user signs out
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setToken(session?.access_token ?? null);
        setUser(session?.user ? toUserShape(session.user) : null);
      });

      return () => {
        window.removeEventListener('nuvanx:unauthorized', onUnauthorized);
        subscription.unsubscribe();
      };
    } else {
      // Fall back to custom backend JWT stored in localStorage.
      // Both token and user are set together once the API confirms the token is valid.
      // Always use a Promise so setState is never called synchronously in the effect body.
      const savedToken = localStorage.getItem('nuvanx_token');
      const loadPromise = savedToken
        ? api.get('/api/auth/me')
            .then((res) => {
              setToken(savedToken);
              setUser(res.data.user);
            })
            .catch(() => {
              localStorage.removeItem('nuvanx_token');
            })
        : Promise.resolve();
      loadPromise.finally(() => setLoading(false));

      return () => {
        window.removeEventListener('nuvanx:unauthorized', onUnauthorized);
      };
    }
  }, []);

  const login = useCallback(async (email, password) => {
    if (isSupabaseAvailable()) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error && data.session) {
        // Supabase Auth succeeded — use the session token
        const shaped = toUserShape(data.user);
        setToken(data.session.access_token);
        setUser(shaped);
        return shaped;
      }
      // Supabase Auth failed (user may only exist in public.users, not in Auth).
      // Fall through to backend JWT path.
    }

    // Backend-JWT path — works against public.users table directly.
    const res = await api.post('/api/auth/login', { email, password });
    const { token: jwt, user: userData } = res.data;
    localStorage.setItem('nuvanx_token', jwt);
    setToken(jwt);
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(async () => {
    if (isSupabaseAvailable()) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem('nuvanx_token');
    setToken(null);
    setUser(null);
  }, []);

  const isAuthenticated = Boolean(token);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
