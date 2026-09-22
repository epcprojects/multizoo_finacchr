'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '../../../lib/api/auth';
import { setToken } from '../../../lib/api/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(email, password);
      setToken(result.accessToken);
      router.push('/');
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response
          ?.data?.message || 'Invalid email or password';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-ink mb-1">
        Sign in
      </h1>

      {error && (
        <p className="text-sm text-danger bg-danger-soft border border-danger/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-soft">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border border-line rounded-md px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="you@multizoo.com"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-soft">Password</span>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border border-line rounded-md px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="••••••••"
        />
      </label>

      <button
        type="submit"
        disabled={loading}
        className="mt-2 bg-accent text-white font-medium text-sm rounded-md px-4 py-2.5 hover:opacity-90 disabled:opacity-60 transition"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
