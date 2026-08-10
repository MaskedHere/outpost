import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authApi, type AuthStatus } from './api';

interface AuthContextValue {
  status: AuthStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const s = await authApi.status();
    setStatus(s);
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  return <AuthContext.Provider value={{ status, loading, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
