'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '../../../lib/api/auth';
import { setToken } from '../../../lib/api/client';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import AuthSplitPanel from '../../../components/auth/AuthSplitPanel';
import ForgotPasswordModal from '../../../components/auth/ForgotPasswordModal';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(email, password);
      setToken(result.accessToken);
      router.push('/dashboard');
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
    <AuthSplitPanel>
      <h2 className="text-black text-xl mb-6 md:mb-8 md:text-3xl font-bold text-center">
        Welcome back 👋
      </h2>

      <form onSubmit={onSubmit} className="w-full space-y-6 md:space-y-8">
        <div className="space-y-6">
          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <Input
            label="Email Address"
            type="email"
            required
            className="py-2.5"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email address"
          />

          <Input
            label="Password"
            type="password"
            required
            className="py-2.5"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
        </div>

        <div className="space-y-3">
          <Button type="submit" disabled={loading} className="w-full" size="lg">
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>

          <div className="flex items-center flex-wrap gap-2 justify-center">
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="text-denim-blue text-sm hover:underline underline-offset-4 md:text-base font-medium"
            >
              Forgot password
            </button>
          </div>
        </div>
      </form>

      <ForgotPasswordModal
        isOpen={forgotOpen}
        onClose={() => setForgotOpen(false)}
      />
    </AuthSplitPanel>
  );
}
