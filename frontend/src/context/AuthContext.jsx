import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseAvailable } from '../lib/supabase/client';
import api, { setAuthToken, clearAuthToken } from '../config/api';

import { AuthContext } from './AuthContextObject';

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
      clearAuthToken();
      setToken(null);
      setUser(null);
    };

    window.addEventListener('nuvanx:unauthorized', onUnauthorized);

    if (isSupabaseAvailable()) {
      supabase.auth.getSession()
        .then(({ data: { session } }) => {
          if (session) {
            setToken(session.access_token);
            setUser(toUserShape(session.user));
          }
        })
        .catch(() => {
          // Keep backend JWT fallback as a contingency path only when session bootstrap fails.
          // No long-lived token is stored locally for security reasons.
        })
        .finally(() => setLoading(false));

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setToken(session?.access_token ?? null);
        setUser(session?.user ? toUserShape(session.user) : null);
      });

      return () => {
        window.removeEventListener('nuvanx:unauthorized', onUnauthorized);
        subscription.unsubscribe();
      };
    }

    setLoading(false);

    return () => {
      window.removeEventListener('nuvanx:unauthorized', onUnauthorized);
    };
  }, []);

  const login = useCallback(async (email, password) => {
    if (isSupabaseAvailable()) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const session = data.session;
      if (!session || !session.user) {
        throw new Error('No session returned from Supabase');
      }
      const userData = toUserShape(session.user);
      const jwt = session.access_token;
      setAuthToken(jwt);
      setToken(jwt);
      setUser(userData);
      return userData;
    }

    const res = await api.post('/api/auth/login', { email, password });
    const { token: jwt, user: userData } = res.data;
    setAuthToken(jwt);
    setToken(jwt);
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(async () => {
    if (isSupabaseAvailable()) {
      await supabase.auth.signOut();
    }
    clearAuthToken();
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
