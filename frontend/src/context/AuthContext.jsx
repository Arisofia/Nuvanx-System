import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseAvailable } from '../lib/supabase/client';
import api from '../config/api';

const AuthContext = createContext(null);

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

      return () => subscription.unsubscribe();
    } else {
      // Fall back to custom backend JWT stored in localStorage
      const savedToken = localStorage.getItem('nuvanx_token');
      setToken(savedToken);
      if (savedToken) {
        api.get('/api/auth/me')
          .then((res) => setUser(res.data.user))
          .catch(() => {
            localStorage.removeItem('nuvanx_token');
            setToken(null);
          })
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    }
  }, []);

  const login = useCallback(async (email, password) => {
    if (isSupabaseAvailable()) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Wrap in an axios-like error shape so Login.jsx toast works the same way
        throw { response: { data: { message: error.message } } };
      }
      const shaped = toUserShape(data.user);
      setToken(data.session.access_token);
      setUser(shaped);
      return shaped;
    }

    // Backend-JWT fallback
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
    } else {
      localStorage.removeItem('nuvanx_token');
    }
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

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
