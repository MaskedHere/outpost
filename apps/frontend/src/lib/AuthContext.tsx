import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authApi, type AuthStatus } from './api';

interface AuthContextValue {
  status: AuthStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const s = await authApi.status();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach the Outpost server');
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ status, loading, error, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
