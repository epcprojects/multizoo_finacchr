'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { acceptInvite } from '../../../lib/api/auth';

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!token) {
      setError('Missing invitation token');
      return;
    }

    setLoading(true);
    try {
      await acceptInvite(token, password);
      setDone(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response
          ?.data?.message || 'Could not accept invitation';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-accent-ink">
        Account activated — redirecting you to sign in…
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-ink mb-1">
        Set your password
      </h1>

      {error && (
        <p className="text-sm text-danger bg-danger-soft border border-danger/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-soft">Password</span>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border border-line rounded-md px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-soft">
          Confirm password
        </span>
        <input
          type="password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="border border-line rounded-md px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>

      <button
        type="submit"
        disabled={loading}
        className="mt-2 bg-accent text-white font-medium text-sm rounded-md px-4 py-2.5 hover:opacity-90 disabled:opacity-60 transition"
      >
        {loading ? 'Activating…' : 'Activate account'}
      </button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
