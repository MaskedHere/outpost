import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { authApi } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

export default function LoginPage() {
  const { status, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && status?.needsSetup) return <Navigate to="/setup" replace />;
  if (!loading && status?.authenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.login(username, password);
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-base-950 px-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500 text-base-950 font-bold">
            O
          </div>
          <span className="text-lg font-semibold text-base-50">Outpost</span>
        </div>

        <label className="label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          className="input mb-4"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoFocus
        />

        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="input mb-6"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
