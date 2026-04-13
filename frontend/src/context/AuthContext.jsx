import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../config/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('nuvanx_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
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
  }, [token]);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/api/auth/login', { email, password });
    const { token: jwt, user: userData } = res.data;
    localStorage.setItem('nuvanx_token', jwt);
    setToken(jwt);
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(() => {
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

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
