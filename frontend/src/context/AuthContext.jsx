import { useMemo, useState } from 'react';
import { AuthContext } from './auth-context.js';

export function AuthProvider({ children }) {
  const [isAuthenticated] = useState(false);
  const value = useMemo(
    () => ({ isAuthenticated, loading: false }),
    [isAuthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
