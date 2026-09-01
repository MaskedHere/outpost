import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { authApi } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import Logo from '../components/Logo';

export default function SetupPage() {
  const { status, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && status && !status.needsSetup) {
    return <Navigate to={status.authenticated ? '/' : '/login'} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await authApi.setup(username, password);
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <motion.form
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        onSubmit={handleSubmit}
        className="card w-full max-w-sm p-8"
      >
        <div className="mb-1 flex items-center gap-2">
          <Logo className="h-8 w-8" />
          <span className="brand-text text-lg font-semibold">Outpost</span>
        </div>
        <h1 className="mb-1 mt-4 text-xl font-semibold text-base-50">Create the admin account</h1>
        <p className="mb-6 text-sm text-base-500">
          This is a one-time setup. Outpost has no other accounts — this admin controls the panel.
        </p>

        <label className="label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          className="input mb-4"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          minLength={3}
          required
        />

        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="input mb-4"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />

        <label className="label" htmlFor="confirm">
          Confirm password
        </label>
        <input
          id="confirm"
          type="password"
          className="input mb-6"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={8}
          required
        />

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <button type="submit" className="btn-primary w-full transition-transform active:scale-95" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account & continue'}
        </button>
      </motion.form>
    </div>
  );
}
