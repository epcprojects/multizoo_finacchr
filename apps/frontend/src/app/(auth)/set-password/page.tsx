'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { acceptInvite, resetPassword } from '../../../lib/api/auth';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import AuthSplitPanel from '../../../components/auth/AuthSplitPanel';

/**
 * Copied 1:1 from EPCCRM's (auth)/set-password/page.tsx — one screen for
 * both the invite flow (`mode=invite`) and the forgot-password flow
 * (`mode=reset`, the default), matching the backend email links it sends.
 */
function SetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() || '';
  const mode = searchParams.get('mode')?.trim() || 'reset';
  const isInviteMode = mode === 'invite';

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
      setError('Reset token is missing or invalid.');
      return;
    }

    setLoading(true);
    try {
      if (isInviteMode) {
        await acceptInvite(token, password);
      } else {
        await resetPassword(token, password, confirmPassword);
      }
      setDone(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ||
        (isInviteMode
          ? 'Failed to complete invite setup.'
          : 'Failed to reset password.');
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-center text-green-600">
        Password set successfully — redirecting you to sign in…
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <h2 className="text-black text-xl md:text-2xl font-bold text-center">
          Set a password
        </h2>
        <h3 className="text-gray-500 text-sm mb-8 md:mb-10.5 md:text-base font-medium text-center">
          Create a password for your account.
        </h3>
      </div>

      <form onSubmit={onSubmit} className="w-full space-y-8 md:space-y-12">
        <div className="space-y-6">
          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <Input
            label="Password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />

          <Input
            label="Confirm Password"
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Password"
          />
        </div>

        <div className="space-y-3">
          <Button type="submit" disabled={loading} className="w-full" size="lg">
            {loading ? 'Setting password...' : 'Set password'}
          </Button>
        </div>
      </form>
    </>
  );
}

export default function SetPasswordPage() {
  return (
    <AuthSplitPanel>
      <Suspense fallback={null}>
        <SetPasswordForm />
      </Suspense>
    </AuthSplitPanel>
  );
}
