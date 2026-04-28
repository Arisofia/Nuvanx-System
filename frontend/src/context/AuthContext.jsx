/* eslint-disable react-refresh/only-export-components */
import { createContext, useMemo, useState } from 'react';

export const AuthContext = createContext({
  isAuthenticated: false,
  loading: false,
});

export function AuthProvider({ children }) {
  const [isAuthenticated] = useState(false);
  const value = useMemo(
    () => ({ isAuthenticated, loading: false }),
    [isAuthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
