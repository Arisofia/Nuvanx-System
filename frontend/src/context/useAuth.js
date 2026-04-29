import { useContext } from 'react';
import { AuthContext } from './auth-context.js';

export function useAuth() {
  return useContext(AuthContext);
}
